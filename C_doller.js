// -*- coding: utf-8 -*-

/**
 * @param {function} f funciton.
 * @return {String[]} argument names.
 */
function argNames(f) {
    var re = /^[\s\(]*function[^(]*\((.*?)\)/;
    var args = f.toString().match(re)[1].split(',');
    return args.map(function(e) {
        return e.replace(/ /g, '');
    });
}

/**
 * @param {Array} a array like object.
 * @return {Array} array object.
 */
function A$(a) {
    var ret = [];
    for (var i = 0, len = a.length; i < len; i++)
        ret[i] = a[i];
    return ret;
}

/**
 * @param {Array} args arguments, callback insterted.
 * @param {String[]} argnames argument names of some functions.
 * @param {funciton} callback function inserted.
 * @param {String[]} [ccand] ccand candidate callback argument name list.
 * @return {Array} arguments modified.
 */
function addCallback(args, argnames, callback, ccand) {
    var index = -1;
    for (var i = 0, len = argnames.length; i < len; i++) {
        if (ccand.indexOf(argnames[i]) != -1) {
            index = i;
            break;
        }
    }
    if (index != -1)
        args.splice(index, 0, callback);
    return args;
}

/**
 * @param {function} f function that may have callback arguments.
 * @param {String[]} [ccand] ccand expected callback names.
 * @return {funciton} funciton object wrapped f.
 */
var C$ = function(f, ccand) {
    var argname = argNames(f);
    ccand = ccand || ['callback', 'call'];

    var rcback = function(f) {
        var arg = A$(arguments);
        arg.shift();
        f = (!!f ? f : function() {});
        return f.apply(this, arg);
    };

    var ret = function() {
        var function_arg = A$(arguments);
        var index = -1;

        function_arg = addCallback(function_arg, argname, function() {
            var args = A$(arguments);
            args.unshift(function() {});
            rcback.apply(this, args);
        }, ccand);

        return f.apply(this, function_arg);
    };

    ret.chain = function(next) {
        var tmp = rcback;
        var next_argname = argNames(next);
        rcback = function(fin) {
            var arg = A$(arguments);
            arg.shift();
            var self = this;
            arg.unshift(function() {
                var arg = A$(arguments);
                fin = (!!fin ? fin : function() {});
                arg = addCallback(arg, next_argname, fin, ccand);
                next.apply(self, arg);
            });
            return tmp.apply(this, arg);
        };
        return ret;
    };
    return ret;
};

module.exports = C$;
/*

var a = C$(function(a, b, callback) {
    console.log('CB0:', a, b, callback);
    callback(a + b);
}).chain(function(callback, b) {
    console.log('CB1:', 'value:', b, 'callback:', callback);
    callback(b * 2);
}).chain(function(b, callback) {
    console.log('CB2:', 'value:', b, 'callback:', callback);
    callback(b + 7);
}).chain(function(callback, b) {
    console.log('CB3:', 'value:', b, 'callback:', callback);
})(1, 2);
*/
