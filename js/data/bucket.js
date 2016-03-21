'use strict';

var featureFilter = require('feature-filter');
var Buffer = require('./buffer');
var StyleLayer = require('../style/style_layer');
var util = require('../util/util');

module.exports = Bucket;

/**
 * Instantiate the appropriate subclass of `Bucket` for `options`.
 * @private
 * @param options See `Bucket` constructor options
 * @returns {Bucket}
 */
Bucket.create = function(options) {
    var Classes = {
        fill: require('./bucket/fill_bucket'),
        line: require('./bucket/line_bucket'),
        circle: require('./bucket/circle_bucket'),
        symbol: require('./bucket/symbol_bucket')
    };
    return new Classes[options.layer.type](options);
};

Bucket.AttributeType = Buffer.AttributeType;


/**
 * The maximum extent of a feature that can be safely stored in the buffer.
 * In practice, all features are converted to this extent before being added.
 *
 * Positions are stored as signed 16bit integers.
 * One bit is lost for signedness to support featuers extending past the left edge of the tile.
 * One bit is lost because the line vertex buffer packs 1 bit of other data into the int.
 * One bit is lost to support features extending past the extent on the right edge of the tile.
 * This leaves us with 2^13 = 8192
 *
 * @private
 * @readonly
 */
Bucket.EXTENT = 8192;

/**
 * The `Bucket` class is the single point of knowledge about turning vector
 * tiles into WebGL buffers.
 *
 * `Bucket` is an abstract class. A subclass exists for each Mapbox GL
 * style spec layer type. Because `Bucket` is an abstract class,
 * instances should be created via the `Bucket.create` method.
 *
 * For performance reasons, `Bucket` creates its "add"s methods at
 * runtime using `new Function(...)`.
 *
 * @class Bucket
 * @private
 * @param options
 * @param {number} options.zoom Zoom level of the buffers being built. May be
 *     a fractional zoom level.
 * @param options.layer A Mapbox GL style layer object
 * @param {Object.<string, Buffer>} options.buffers The set of `Buffer`s being
 *     built for this tile. This object facilitates sharing of `Buffer`s be
       between `Bucket`s.
 */
function Bucket(options) {
    this.zoom = options.zoom;
    this.overscaling = options.overscaling;
    this.layer = options.layer;

    this.layers = [this.layer.id];
    this.type = this.layer.type;
    this.features = [];
    this.id = this.layer.id;
    this['source-layer'] = this.layer['source-layer'];
    this.interactive = this.layer.interactive;
    this.minZoom = this.layer.minzoom;
    this.maxZoom = this.layer.maxzoom;

    if (options.elementGroups) {
        this.elementGroups = options.elementGroups;
        this.buffers = util.mapObject(options.buffers, function(options) {
            return new Buffer(options);
        });
    }
}

/**
 * Build the buffers! Features are set directly to the `features` property.
 * @private
 */
Bucket.prototype.populateBuffers = function() {
    this.createStyleLayer();
    this.createBuffers();

    for (var i = 0; i < this.features.length; i++) {
        this.addFeature(this.features[i]);
    }

    this.trimBuffers();
};

/**
 * Check if there is enough space available in the current element group for
 * `vertexLength` vertices. If not, append a new elementGroup. Should be called
 * by `populateBuffers` and its callees.
 * @private
 * @param {string} programName the name of the program associated with the buffer that will receive the vertices
 * @param {number} vertexLength The number of vertices that will be inserted to the buffer.
 */
Bucket.prototype.makeRoomFor = function(programName, numVertices) {
    var groups = this.elementGroups[programName];
    var currentGroup = groups.length && groups[groups.length - 1];

    if (!currentGroup || currentGroup.vertexLength + numVertices > 65535) {
        var vertexBuffer = this.buffers[this.getBufferName(programName, 'vertex')];
        var elementBuffer = this.buffers[this.getBufferName(programName, 'element')];
        var secondElementBuffer = this.buffers[this.getBufferName(programName, 'secondElement')];

        currentGroup = new ElementGroup(
            vertexBuffer.length,
            elementBuffer && elementBuffer.length,
            secondElementBuffer && secondElementBuffer.length
        );
        groups.push(currentGroup);
    }

    return currentGroup;
};

/**
 * Start using a new shared `buffers` object and recreate instances of `Buffer`
 * as necessary.
 * @private
 */
Bucket.prototype.createBuffers = function() {
    var elementGroups = this.elementGroups = {};
    var buffers = this.buffers = {};

    for (var programName in this.programInterfaces) {
        var programInterface = this.programInterfaces[programName];

        if (programInterface.vertexBuffer) {
            var vertexBufferName = this.getBufferName(programName, 'vertex');
            var vertexAddMethodName = this.getAddMethodName(programName, 'vertex');

            buffers[vertexBufferName] = new Buffer({
                type: Buffer.BufferType.VERTEX,
                attributes: programInterface.attributes
            });

            this[vertexAddMethodName] = this[vertexAddMethodName] || createVertexAddMethod(
                programName,
                programInterface,
                this.getBufferName(programName, 'vertex')
            );
        }

        if (programInterface.elementBuffer) {
            var elementBufferName = this.getBufferName(programName, 'element');
            buffers[elementBufferName] = createElementBuffer(programInterface.elementBufferComponents);
            this[this.getAddMethodName(programName, 'element')] = createElementAddMethod(this.buffers[elementBufferName]);
        }

        if (programInterface.secondElementBuffer) {
            var secondElementBufferName = this.getBufferName(programName, 'secondElement');
            buffers[secondElementBufferName] = createElementBuffer(programInterface.secondElementBufferComponents);
            this[this.getAddMethodName(programName, 'secondElement')] = createElementAddMethod(this.buffers[secondElementBufferName]);
        }

        elementGroups[programName] = [];
    }
};

Bucket.prototype.destroy = function(gl) {
    for (var k in this.buffers) {
        this.buffers[k].destroy(gl);
    }
};

Bucket.prototype.trimBuffers = function() {
    for (var bufferName in this.buffers) {
        this.buffers[bufferName].trim();
    }
};

/**
 * Get the name of the method used to add an item to a buffer.
 * @param {string} programName The name of the program that will use the buffer
 * @param {string} type One of "vertex", "element", or "secondElement"
 * @returns {string}
 */
Bucket.prototype.getAddMethodName = function(programName, type) {
    return 'add' + capitalize(programName) + capitalize(type);
};

/**
 * Get the name of a buffer.
 * @param {string} programName The name of the program that will use the buffer
 * @param {string} type One of "vertex", "element", or "secondElement"
 * @returns {string}
 */
Bucket.prototype.getBufferName = function(programName, type) {
    return programName + capitalize(type);
};

Bucket.prototype.serialize = function() {
    return {
        layer: {
            id: this.layer.id,
            type: this.layer.type
        },
        zoom: this.zoom,
        elementGroups: this.elementGroups,
        buffers: util.mapObject(this.buffers, function(buffer) {
            return buffer.serialize();
        })
    };
};

Bucket.prototype.createStyleLayer = function() {
    if (!(this.layer instanceof StyleLayer)) {
        this.layer = StyleLayer.create(this.layer);
        this.layer.recalculate(this.zoom, { lastIntegerZoom: Infinity, lastIntegerZoomTime: 0, lastZoom: 0 });
    }
};

Bucket.prototype.createFilter = function() {
    if (!this.filter) {
        this.filter = featureFilter(this.layer.filter);
    }
};


var createVertexAddMethodCache = {};
function createVertexAddMethod(programName, programInterface, bufferName) {
    var pushArgs = [];
    for (var i = 0; i < programInterface.attributes.length; i++) {
        pushArgs = pushArgs.concat(programInterface.attributes[i].value);
    }

    var body = 'return this.buffers.' + bufferName + '.push(' + pushArgs.join(', ') + ');';

    if (!createVertexAddMethodCache[body]) {
        createVertexAddMethodCache[body] = new Function(programInterface.attributeArgs, body);
    }

    return createVertexAddMethodCache[body];
}

function createElementAddMethod(buffer) {
    return function(one, two, three) {
        return buffer.push(one, two, three);
    };
}

function createElementBuffer(components) {
    return new Buffer({
        type: Buffer.BufferType.ELEMENT,
        attributes: [{
            name: 'vertices',
            components: components || 3,
            type: Buffer.ELEMENT_ATTRIBUTE_TYPE
        }]
    });
}

function capitalize(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function ElementGroup(vertexStartIndex, elementStartIndex, secondElementStartIndex) {
    // the offset into the vertex buffer of the first vertex in this group
    this.vertexStartIndex = vertexStartIndex;
    this.elementStartIndex = elementStartIndex;
    this.secondElementStartIndex = secondElementStartIndex;
    this.elementLength = 0;
    this.vertexLength = 0;
    this.secondElementLength = 0;
}
