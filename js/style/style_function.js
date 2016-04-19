'use strict';

var MapboxGLFunction = require('mapbox-gl-function');

// For when the feature values index into the `stop` array. i.e. 0, 1, 2, ...
exports.categorical = function(parameters) {
    var stops = parameters.stops,
        property = parameters.property;

    var outer = function(globalProperties, featureProperties) {
        var input = (featureProperties || {})[property];
        return stops[input | 0][1];
    };
    outer.isFeatureConstant = false;
    outer.isGlobalConstant = undefined;
    return outer;
};

exports.interpolated = function(parameters) {
    var inner = MapboxGLFunction.interpolated(parameters);
    var outer = function(globalProperties, featureProperties) {
        return inner(globalProperties && globalProperties.zoom, featureProperties || {});
    };
    outer.isFeatureConstant = inner.isFeatureConstant;
    outer.isGlobalConstant = inner.isGlobalConstant;
    return outer;
};

exports['piecewise-constant'] = function(parameters) {
    var inner = MapboxGLFunction['piecewise-constant'](parameters);
    var outer = function(globalProperties, featureProperties) {
        return inner(globalProperties && globalProperties.zoom, featureProperties || {});
    };
    outer.isFeatureConstant = inner.isFeatureConstant;
    outer.isGlobalConstant = inner.isGlobalConstant;
    return outer;
};

exports.isFunctionDefinition = MapboxGLFunction.isFunctionDefinition;
