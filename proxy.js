// -*- flymake-gjshint: jshint; -*-
/* jshint forin:true, noarg:true, noempty:true, eqeqeq:true, bitwise:true, strict:false, undef:true, unused:true, curly:true, node:true, indent:4, maxerr:100 */
var url  = require('url'),
    sys  = require('sys'),
    http = require('http'),
    fs   = require('fs'),
    libxmljs = require("libxmljs"),
    zlib     = require('zlib'),
    buffer   = require('buffer');

var ids = [];
var opts = {
    port: 8555
};

// list: [li]
// ids: [data-post-id]
function filterContent(list, ids) {
    for(var i = 0, len = list.length; i < len; i++) {
        var idx = list[i].childNodes()[1];
        if(!idx){ continue; }
        var attr= idx.attr("data-root-id");

        if(ids.indexOf(attr.value()) !== -1) {
            console.log("removed: " + attr.value());
            attr.remove(); // この行を消してはいけない。lxmljsのバグでGC時に死ぬ
            idx.remove();
        } else {
            console.log("added: " + attr.value());
            ids.push(attr.value());
        }
    }
    return {ids:ids, xml: list};
}

// lxml output -> original tumblr format html
function convertIntoHTML5(txt) {
    txt = txt.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "");
    txt = txt.replace(/<(\w+)( [^\/>]+(\/[^\/>]*)*)?\/>/g, "<$1$2></$1>");
    txt = txt.replace(/<\/?(?:html|body)>/g, "");
    txt = txt.slice(txt.indexOf('\n')+1);
    txt = txt.slice(txt.indexOf('\n')+1);
    return txt;
}

function scrape(body) {
    var xml = libxmljs.parseHtml(body);
    var lis = xml.find('//li[@class="post_container"]');
    filterContent(lis, ids);
    console.log("ids length:" + ids.length);
    return convertIntoHTML5(xml.toString());
}

function tumblrRequest(serverRequest, serverResponse, ajaxmode) {
    var requestUrl = url.parse(serverRequest.url);
    var buf = [];
    
    function requestCallback(response) {
        serverResponse.writeHead(response.statusCode, response.headers);
        response.on('data', function(chunk) {
            buf.push(chunk);
        });
        response.on('end', function() {
            zlib.gunzip(buffer.Buffer.concat(buf), function(err, body){
                if(!!err) {
                    console.log("tumblr decode error: "+err);
                    return;
                }
                var ret = "";
                if(ajaxmode) {
                    ret = scrape(body);
                } else {
                    body = body.toString();
					var re = /<!-- START POSTS -->([\s\S]+)<!-- END POSTS -->/;
                    var inline = body.match(re)[1];
                    ret = scrape(inline);
                    ret = body.replace(re, "<!-- START POSTS -->" + ret + "<!-- END POSTS -->");
                }

                zlib.gzip(ret, function(err, buf) {
                    serverResponse.write(buf);
                    serverResponse.end();
                    saveCache(opts["cache"], function(){});
                });
            });
        });
    }

    // クライアントから受け取った通りにリクエスト
    var request = http.request({
        host:    serverRequest.headers.host,
        port:    requestUrl.port || 80,
        path:    requestUrl.path,
        method:  serverRequest.method,
        headers: serverRequest.headers
    }, requestCallback);

    request.on('error', function(e) {
        console.log('problem with request: ' + e.message);
    });

    serverRequest.on('data', function(data) {
        request.write(data);
    });
    serverRequest.on('end', function() {
        request.end();
    });
    serverRequest.on('error', function(e){
        console.log('problem with request: ' + e.message);
    });
}

function normalRequest(serverRequest, serverResponse) {
    var requestUrl = url.parse(serverRequest.url);
    
    function requestCallback(response) {
        serverResponse.writeHead(response.statusCode, response.headers);
        response.on('data', function(chunk) {
            serverResponse.write(chunk);
        });
        response.on('end', function() {
            serverResponse.end();
        });
    }

    // クライアントから受け取った通りにリクエスト
    var request = http.request({
        host:    serverRequest.headers.host,
        port:    requestUrl.port || 80,
        path:    requestUrl.path,
        method:  serverRequest.method,
        headers: serverRequest.headers
    }, requestCallback);

    request.on('error', function(e) {
        console.log('problem with request: ' + e.message);
    });

    serverRequest.on('data', function(data) {
        request.write(data);
    });
    serverRequest.on('end', function() {
        request.end();
    });
    serverRequest.on('error', function(e){
        console.log('problem with request: ' + e.message);
    });
}

function readJSON (path, callback) {
    try{ fs.readFile(path, 'utf8', function(err, data) {
        if(!!err) {
            return callback(null, err);
        } else {
            try {
                return callback(JSON.parse(data));
            } catch(e) {
                return callback(null, e);
            }
        }
    });} catch(e) {
        callback(null, e);
    }
}

function saveCache(path, callback) {
    if(!!path)
        fs.writeFile(path, JSON.stringify(ids), callback);
}

function loadCache(opts, callback) {
    if(!("cache" in opts)) {
        return callback(null);
    } else {
        readJSON(opts["cache"], function(cache, err) {
            if(!!err) {
                if(err["code"] == 'ENOENT') return callback(null);
                console.log(err);
                return process.abort();
            } else {
                ids = cache || [];
                return callback(cache);
            }
        });
    }

}

function loadOpts(nextTo) {
    var argv = process.argv, path;
    if(argv.indexOf("-h") != -1) {
        console.log("Useage :", argv[1], "[options.json]");
        process.exit();
    } 

    path = (argv.length < 3) ? "options.json" : argv[2];
    readJSON(path, function(conf, err) {
        if(!!err) {
            console.log(err);
            process.abort();
        }
        for(var i in conf) {
            opts[i] = conf[i];
            console.log(i, ":", conf[i]);
        }

        loadCache(opts, function(){nextTo(opts);});
    });
    
}

loadOpts(function(opts) {
    http.createServer(function(serverRequest, serverResponse) {
        var requestUrl = url.parse(serverRequest.url);

        if(requestUrl.href.match(/^http:\/\/www\.tumblr\.com\/dashboard(\/\d+)*$/)) {
            console.log("***:" + requestUrl.href);
            if(!!serverRequest.headers["x-requested-with"]) {
                console.log("****:Ajax mode");
                tumblrRequest(serverRequest, serverResponse, true);
            } else {
                tumblrRequest(serverRequest, serverResponse, false);
            }
        } else {
            normalRequest(serverRequest, serverResponse);
        }
    }).listen(opts.port);

    sys.puts('Server listening on port ' + opts.port);
});
