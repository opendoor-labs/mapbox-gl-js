'use strict';

var Bucket = require('../bucket');
var util = require('../../util/util');
var loadGeometry = require('../load_geometry');
var EXTENT = Bucket.EXTENT;

module.exports = CircleBucket;

/**
 * Circles are represented by two triangles.
 *
 * Each corner has a pos that is the center of the circle and an extrusion
 * vector that is where it points.
 * @private
 */
function CircleBucket() {
    Bucket.apply(this, arguments);
}

CircleBucket.prototype = util.inherit(Bucket, {});

CircleBucket.prototype.addCircleVertex = function(x, y, extrudeX, extrudeY) {
    return this.arrays.circleVertex.emplaceBack(
            (x * 2) + ((extrudeX + 1) / 2),
            (y * 2) + ((extrudeY + 1) / 2));
};

CircleBucket.prototype.programInterfaces = {
    circle: {
        vertexBuffer: true,
        elementBuffer: true,

        attributes: [{
            name: 'a_pos',
            components: 2,
            type: 'Int16'
        }, {
            name: 'a_color',
            components: 4,
            type: 'Uint8',
            getValue: function(layer, globalProperties, featureProperties) {
                return util.premultiply(layer.getPaintValue("circle-color", globalProperties, featureProperties));
            },
            multiplier: 255,
            paintProperty: 'circle-color'
        }, {
            name: 'a_radius',
            components: 1,
            type: 'Uint16',
            isLayerConstant: false,
            getValue: function(layer, globalProperties, featureProperties) {
                return [layer.getPaintValue("circle-radius", globalProperties, featureProperties)];
            },
            multiplier: 10,
            paintProperty: 'circle-radius'
        }]
    }
};

CircleBucket.prototype.addFeature = function(feature) {
    var globalProperties = {zoom: this.zoom};
    var geometries = loadGeometry(feature);

    var startIndex = this.arrays.circleVertex.length;

    for (var j = 0; j < geometries.length; j++) {
        for (var k = 0; k < geometries[j].length; k++) {

            var x = geometries[j][k].x;
            var y = geometries[j][k].y;

            // Do not include points that are outside the tile boundaries.
            if (x < 0 || x >= EXTENT || y < 0 || y >= EXTENT) continue;

            // this geometry will be of the Point type, and we'll derive
            // two triangles from it.
            //
            // ┌─────────┐
            // │ 3     2 │
            // │         │
            // │ 0     1 │
            // └─────────┘

            var group = this.makeRoomFor('circle', 4);

            var index = this.addCircleVertex(x, y, -1, -1) - group.vertexStartIndex;
            this.addCircleVertex(x, y, 1, -1);
            this.addCircleVertex(x, y, 1, 1);
            this.addCircleVertex(x, y, -1, 1);
            group.vertexLength += 4;

            this.arrays.circleElement.emplaceBack(index, index + 1, index + 2);
            this.arrays.circleElement.emplaceBack(index, index + 3, index + 2);
            group.elementLength += 2;
        }
    }

    this.addPaintAttributes('circle', globalProperties, feature.properties, startIndex, this.arrays.circleVertex.length);
};
