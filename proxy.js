// -*- flymake-gjshint: jshint; -*-
/* jshint forin:true, noarg:true, noempty:true, eqeqeq:true, bitwise:true, strict:false, undef:true, unused:true, curly:true, node:true, indent:4, maxerr:100 */
var url  = require('url'),
    sys  = require('sys'),
    http = require('http'),
    fs   = require('fs'),
    libxmljs = require("libxmljs"),
    zlib     = require('zlib'),
    buffer   = require('buffer'),
    C$       = require('./C_doller.js');

var ids = [];
var opts = {
    port: 8555
};

function attribute(elm, attr, val) {
    var a = elm.attr(attr);
    var ret = undefined;
    
    if(!val) {
        ret = a.value();
    } else {
        a.value(val);
    }
    a.remove();
    return ret;
}

// list: [<li>]
function diplayPreviousFirstPost(list) {
    for(var i = 0, len = list.length; i < len; i++) {
        var idx = list[i].childNodes()[1]; // li > div
        if(!idx){ continue; }
        var pid = attribute(idx, "data-post-id");

        if(!opts["internal.first_post.curr"]){
            console.log("pid:", pid);
            opts["internal.first_post.curr"] = pid;
        }

        if(opts["internal.first_post.prev"] == pid) {
            console.log("add");
            var li = list[i].clone();
            var disp = li.childNodes()[1];
            li.childNodes()[1].attr({"data-root-id": "0", "data-type": "angelSight"});

            disp.get('div[@class="post_wrapper"]').remove();
            var elm = disp.node('div');
            elm.attr({"class": "post_wrapper"});
            elm.text("死");

            list[i].addPrevSibling(li);

        }
    }

}

// list: [<li>]
// ids: [data-post-id]
function filterContent(list, ids) {
    for(var i = 0, len = list.length; i < len; i++) {
        var idx = list[i].childNodes()[1]; // li > div
        if(!idx){ continue; }
        var attr = idx.attr("data-root-id");
        var post_type = idx.attr("data-type");

        if(ids.indexOf(attr.value()) !== -1) {
            // 既読posts
            console.log("removed: " + attr.value());
            attr.remove(); // この行を消してはいけない。lxmljsのバグでGC時に死ぬ
            post_type.remove();// 同上
            idx.remove();
        } else if (opts['exclude.id'].indexOf(attr.value()) != -1) {
            // 保護posts
            console.log("defilterd: " + attr.value());
        } else if (opts['filter.post_type'].indexOf(post_type.value()) != -1) {
            // 除外type
            console.log("removed by type(" + post_type.value() + "): " + attr.value());
            attr.remove();
            post_type.remove();
            idx.remove();
        } else {
            // その他(表示)
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
    diplayPreviousFirstPost(lis);
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
                    saveCache(opts["filter.cache"], function(){});
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
    try{ 
        fs.readFile(path, 'utf8', function(err, data) {
            if(!!err) {
                return callback(null, err);
            } else {
                try {
                    return callback(JSON.parse(data));
                } catch(e) {
                    return callback(null, e);
                }
            }
        });
    } catch(e) {
        callback(null, e);
    }
}

function saveCache(path, callback) {
    if(!!path) {
        fs.writeFile(path, JSON.stringify(ids), callback);
    }
}

function loadCache(path, callback) {
    readJSON(opts["filter.cache"], function(cache, err) {
        if(!!err) {
            console.log(err);
            if(err["code"] == 'ENOENT') return callback(null);
            return process.abort();
        } else {
            ids = cache || [];
            
            ids = ids.filter(function(id) {
                return opts["exclude.id"].indexOf(id) == -1;
            });
            
            return callback(cache);
        }
    });
}

function loadOpts(callback) {
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

        opts["exclude.id"] = opts["exclude.id"] || [];
        opts["exclude.id"] = opts["exclude.id"].map(function(e) {
            return e.toString();
        });

        if(opts["filter.post_type"].indexOf("angelSight") === -1) {
            opts["filter.post_type"].push("angelSight");
        }

        loadCache(opts["filter.cache"], function(){callback(opts);});
    });
    
}

C$(loadOpts).chain(function(opts_) {    
    opts = opts_;
    http.createServer(function(serverRequest, serverResponse) {
        var requestUrl = url.parse(serverRequest.url);

        if(requestUrl.href.match(/^http:\/\/www\.tumblr\.com\/dashboard(\/\d+)*$/)) {
            console.log("***:" + requestUrl.href);
            if(!!serverRequest.headers["x-requested-with"]) {
                console.log("****:Ajax mode");
                tumblrRequest(serverRequest, serverResponse, true);
            } else {
                opts["internal.first_post.prev"] = opts["internal.first_post.curr"] || 0;
                opts["internal.first_post.curr"] = 0;
                console.log("prev:", opts["internal.first_post.prev"]);
                console.log("curr:", opts["internal.first_post.curr"]);

                tumblrRequest(serverRequest, serverResponse, false);
            }
        } else {
            normalRequest(serverRequest, serverResponse);
        }
    }).listen(opts.port);

    sys.puts('Server listening on port ' + opts.port);
})();
