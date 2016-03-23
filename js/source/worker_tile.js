'use strict';

var FeatureTree = require('../data/feature_tree');
var CollisionTile = require('../symbol/collision_tile');
var Bucket = require('../data/bucket');

module.exports = WorkerTile;

function WorkerTile(params) {
    this.coord = params.coord;
    this.uid = params.uid;
    this.zoom = params.zoom;
    this.tileSize = params.tileSize;
    this.source = params.source;
    this.overscaling = params.overscaling;
    this.angle = params.angle;
    this.pitch = params.pitch;
    this.showCollisionBoxes = params.showCollisionBoxes;
}
var COLOR_OFFSET = 10000000000;

WorkerTile.prototype.parse = function(data, layers, actor, callback) {

    this.status = 'parsing';

    this.featureTree = new FeatureTree(this.coord, this.overscaling);

    var stats = { _total: 0 };

    var tile = this;
    var bucketsById = {};
    var bucketsBySourceLayer = {};
    var i;
    var layer;
    var sourceLayerId;
    var bucket;

    // Map non-ref layers to buckets.
    for (i = 0; i < layers.length; i++) {
        layer = layers[i];

        if (layer.source !== this.source) continue;
        if (layer.ref) continue;
        if (layer.minzoom && this.zoom < layer.minzoom) continue;
        if (layer.maxzoom && this.zoom >= layer.maxzoom) continue;
        if (layer.layout && layer.layout.visibility === 'none') continue;

        bucket = Bucket.create({
            layer: layer,
            zoom: this.zoom,
            overscaling: this.overscaling,
            showCollisionBoxes: this.showCollisionBoxes
        });
        bucket.createFilter();

        bucketsById[layer.id] = bucket;

        if (data.layers) { // vectortile
            sourceLayerId = layer['source-layer'];
            bucketsBySourceLayer[sourceLayerId] = bucketsBySourceLayer[sourceLayerId] || {};
            bucketsBySourceLayer[sourceLayerId][layer.id] = bucket;
        }
    }

    // Index ref layers.
    for (i = 0; i < layers.length; i++) {
        layer = layers[i];
        if (layer.source === this.source && layer.ref && bucketsById[layer.ref]) {
            bucketsById[layer.ref].layers.push(layer.id);
        }
    }

    // read each layer, and sort its features into buckets
    if (data.layers) { // vectortile
        for (sourceLayerId in bucketsBySourceLayer) {
            layer = data.layers[sourceLayerId];
            if (layer) {
                sortLayerIntoBuckets(layer, bucketsBySourceLayer[sourceLayerId]);
            }
        }
    } else { // geojson
        sortLayerIntoBuckets(data, bucketsById);
    }

    // PATCH BEGINS HERE

    function featuresFind(layer, color, time) {
        // Finds the index of the first point with close_date greater than the given time.
        // See: http://stackoverflow.com/questions/6553970/find-the-first-element-in-an-array-that-is-greater-than-the-target
        var find = time + color * COLOR_OFFSET;
        var low = 0;
        var high = layer.length;
        var mid;
        var properties;

        while (low !== high) {
            mid = Math.floor((low + high) / 2);
            properties = layer.feature(mid).properties;

            if ((properties.d + properties.c * COLOR_OFFSET) - find < 0) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        // null means the searched for value is greater than all values in
        // layer features.
        return low === layer.length ? null : low;
    }

    function featuresSlice(layer, begin, end) {
        var n = end - begin;
        var slice = new Array(n);
        while (n--) {
            slice[n] = layer.feature(n + begin);
        }
        return slice;
    }

    function sortLayerIntoBuckets(layer, buckets) {
        if (layer.name === 'markers') {
            return sortLayerIntoBucketsBinarySearch(layer, buckets);
        }
        for (var i = 0; i < layer.length; i++) {
            var feature = layer.feature(i);
            for (var id in buckets) {
                if (buckets[id].filter(feature))
                    buckets[id].features.push(feature);
            }
        }
    }

    function sortLayerIntoBucketsBinarySearch(layer, buckets) {
        for (var id in buckets) {
            var filterValues = getFilters(buckets[id].layer.filter);

            var startIdx = featuresFind(layer, filterValues.colorIdx, filterValues.startTime);
            var endIdx = featuresFind(layer, filterValues.colorIdx, filterValues.endTime);
            if (startIdx && !endIdx) {
                endIdx = layer.length;
            }
            var featureSlice = featuresSlice(layer, startIdx, endIdx);

            buckets[id].features = featureSlice;
        }
    }

    function getFilters(filter) {
        var values = {};
        for (var i = 1; i < filter.length; i++) {
            var filterSpec = filter[i];
            if (filterSpec[1] === 'c') {
                values.colorIdx = filterSpec[2];
            } else if (filterSpec[1] === 'd') {
                if (filterSpec[0].charAt(0) === '>') {
                    values.startTime = filterSpec[2];
                } else {
                    values.endTime = filterSpec[2];
                }
            }
        }
        return values;
    }


    // PATCH ENDS HERE

    var buckets = [],
        symbolBuckets = this.symbolBuckets = [],
        otherBuckets = [];

    var collisionTile = new CollisionTile(this.angle, this.pitch);

    for (var id in bucketsById) {
        bucket = bucketsById[id];
        if (bucket.features.length === 0) continue;

        buckets.push(bucket);

        if (bucket.type === 'symbol')
            symbolBuckets.push(bucket);
        else
            otherBuckets.push(bucket);
    }

    var icons = {};
    var stacks = {};
    var deps = 0;


    if (symbolBuckets.length > 0) {

        // Get dependencies for symbol buckets
        for (i = symbolBuckets.length - 1; i >= 0; i--) {
            symbolBuckets[i].updateIcons(icons);
            symbolBuckets[i].updateFont(stacks);
        }

        for (var fontName in stacks) {
            stacks[fontName] = Object.keys(stacks[fontName]).map(Number);
        }
        icons = Object.keys(icons);

        actor.send('get glyphs', {uid: this.uid, stacks: stacks}, function(err, newStacks) {
            stacks = newStacks;
            gotDependency(err);
        });

        if (icons.length) {
            actor.send('get icons', {icons: icons}, function(err, newIcons) {
                icons = newIcons;
                gotDependency(err);
            });
        } else {
            gotDependency();
        }
    }

    // immediately parse non-symbol buckets (they have no dependencies)
    for (i = otherBuckets.length - 1; i >= 0; i--) {
        parseBucket(this, otherBuckets[i]);
    }

    if (symbolBuckets.length === 0)
        return done();

    function gotDependency(err) {
        if (err) return callback(err);
        deps++;
        if (deps === 2) {
            // all symbol bucket dependencies fetched; parse them in proper order
            for (var i = symbolBuckets.length - 1; i >= 0; i--) {
                parseBucket(tile, symbolBuckets[i]);
            }
            done();
        }
    }

    function parseBucket(tile, bucket) {
        var now = Date.now();
        bucket.populateBuffers(collisionTile, stacks, icons);
        var time = Date.now() - now;

        if (bucket.interactive) {
            for (var i = 0; i < bucket.features.length; i++) {
                var feature = bucket.features[i];
                tile.featureTree.insert(feature.bbox(), bucket.layers, feature);
            }
        }

        bucket.features = null;

        stats._total += time;
        stats[bucket.id] = (stats[bucket.id] || 0) + time;
    }

    function done() {
        tile.status = 'done';

        if (tile.redoPlacementAfterDone) {
            tile.redoPlacement(tile.angle, tile.pitch, null);
            tile.redoPlacementAfterDone = false;
        }

        callback(null, {
            buckets: buckets.filter(isBucketEmpty).map(serializeBucket),
            bucketStats: stats // TODO put this in a separate message?
        }, getTransferables(buckets));
    }
};

WorkerTile.prototype.redoPlacement = function(angle, pitch, showCollisionBoxes) {
    if (this.status !== 'done') {
        this.redoPlacementAfterDone = true;
        this.angle = angle;
        return {};
    }

    var collisionTile = new CollisionTile(angle, pitch);
    var buckets = this.symbolBuckets;

    for (var i = buckets.length - 1; i >= 0; i--) {
        buckets[i].placeFeatures(collisionTile, showCollisionBoxes);
    }

    return {
        result: {
            buckets: buckets.filter(isBucketEmpty).map(serializeBucket)
        },
        transferables: getTransferables(buckets)
    };
};

function isBucketEmpty(bucket) {
    for (var bufferName in bucket.buffers) {
        if (bucket.buffers[bufferName].length > 0) return true;
    }
    return false;
}

function serializeBucket(bucket) {
    return bucket.serialize();
}

function getTransferables(buckets) {
    var transferables = [];
    for (var i in buckets) {
        var bucket = buckets[i];
        for (var j in bucket.buffers) {
            transferables.push(bucket.buffers[j].arrayBuffer);
        }
    }
    return transferables;
}
