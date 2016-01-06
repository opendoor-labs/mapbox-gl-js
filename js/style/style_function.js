'use strict';

var createMapboxGLFunction = require('mapbox-gl-function');

function create(reference, parameters) {
    return createMapboxGLFunction(migrate(reference, parameters));
}

function migrate(reference, input) {
    if (input && input.stops) {
        var output = { base: input.base, property: input.property };

        output.domain = [];
        output.range = [];
        for (var i = 0; i < input.stops.length; i++) {
            output.domain.push(input.stops[i][0]);
            output.range.push(input.stops[i][1]);
        }

        if (reference.function === 'interpolated') {
            output.type = 'exponential';
        } else {
            output.domain.shift();
            output.type = 'interval';
        }

        return output;
    } else {
        return input;
    }
}

module.exports = create;
