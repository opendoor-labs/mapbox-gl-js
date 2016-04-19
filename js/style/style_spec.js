'use strict';

var spec = require('mapbox-gl-style-spec/reference/latest');
spec['paint_circle']['circle-color']['function'] = 'categorical';
module.exports = spec;
