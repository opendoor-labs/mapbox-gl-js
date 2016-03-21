'use strict';

var TilePyramid = require('../source/tile_pyramid');
var pyramid = new TilePyramid({ tileSize: 512 });
var util = require('../util/util');
var EXTENT = require('../data/bucket').EXTENT;

module.exports = drawBackground;

function drawBackground(painter, source, layer) {
    var gl = painter.gl;
    var transform = painter.transform;
    var color = util.premultiply(layer.paint['background-color'], layer.paint['background-opacity']);
    var image = layer.paint['background-pattern'];
    var opacity = layer.paint['background-opacity'];
    var program;

    var imagePosA = image ? painter.spriteAtlas.getPosition(image.from, true) : null;
    var imagePosB = image ? painter.spriteAtlas.getPosition(image.to, true) : null;

    painter.setDepthSublayer(0);
    if (imagePosA && imagePosB) {

        if (painter.isOpaquePass) return;

        // Draw texture fill
        program = painter.useProgram('pattern');
        gl.uniform1i(program.u_image, 0);
        gl.uniform2fv(program.u_pattern_tl_a, imagePosA.tl);
        gl.uniform2fv(program.u_pattern_br_a, imagePosA.br);
        gl.uniform2fv(program.u_pattern_tl_b, imagePosB.tl);
        gl.uniform2fv(program.u_pattern_br_b, imagePosB.br);
        gl.uniform1f(program.u_opacity, opacity);
        gl.uniform1f(program.u_mix, image.t);

        var factor = (EXTENT / transform.tileSize) / Math.pow(2, 0);

        gl.uniform2fv(program.u_patternscale_a, [
            1 / (imagePosA.size[0] * factor * image.fromScale),
            1 / (imagePosA.size[1] * factor * image.fromScale)
        ]);

        gl.uniform2fv(program.u_patternscale_b, [
            1 / (imagePosB.size[0] * factor * image.toScale),
            1 / (imagePosB.size[1] * factor * image.toScale)
        ]);

        gl.uniform1i(program.u_image, 0);
        gl.activeTexture(gl.TEXTURE0);
        painter.spriteAtlas.bind(gl, true);

    } else {
        // Draw filling rectangle.
        if (painter.isOpaquePass !== (color[3] === 1)) return;

        program = painter.useProgram('fill');
        gl.uniform4fv(program.u_color, color);
    }

    gl.disable(gl.STENCIL_TEST);

    gl.bindBuffer(gl.ARRAY_BUFFER, painter.tileExtentBuffer);
    gl.vertexAttribPointer(program.a_pos, painter.tileExtentBuffer.itemSize, gl.SHORT, false, 0, 0);

    // We need to draw the background in tiles in order to use calculatePosMatrix
    // which applies the projection matrix (transform.projMatrix). Otherwise
    // the depth and stencil buffers get into a bad state.
    // This can be refactored into a single draw call once earcut lands and
    // we don't have so much going on in the stencil buffer.
    var coords = pyramid.coveringTiles(transform);
    for (var c = 0; c < coords.length; c++) {
        painter.setPosMatrix(painter.calculatePosMatrix(coords[c]));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, painter.tileExtentBuffer.itemCount);
    }

    gl.stencilMask(0x00);
    gl.stencilFunc(gl.EQUAL, 0x80, 0x80);
}
