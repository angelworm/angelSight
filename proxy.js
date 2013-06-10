// -*- flymake-gjshint: jshint; -*-
/* jshint forin:true, noarg:true, noempty:true, eqeqeq:true, bitwise:true, strict:false, undef:true, unused:true, curly:true, node:true, indent:4, maxerr:100 */
var url  = require('url'),
    sys  = require('sys'),
    http = require('http'),
    libxmljs = require("libxmljs"),
    zlib     = require('zlib'),
    buffer   = require('buffer');

var port = 8555;
var ids = [];

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
                    var inline = body.replace(/[\s\S]+<!-- START POSTS -->([\s\S]+)<!-- END POSTS -->[\s\S]+/, "$1");
                    ret = scrape(inline);
                    ret = body.replace(/<!-- START POSTS -->[\s\S]+<!-- END POSTS -->/, "<!-- START POSTS -->" + ret + "<!-- END POSTS -->");
                }

                zlib.gzip(ret, function(err, buf) {
                    serverResponse.write(buf);
                    serverResponse.end();
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
}).listen(port);

sys.puts('Server listening on port ' + port);
