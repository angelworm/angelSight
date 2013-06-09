var url  = require('url'),
    sys  = require('sys'),
    http = require('http'),
    libxmljs = require("libxmljs"),
    zlib     = require('zlib'),
    Buffer   = require('buffer').Buffer;

var port = 8555;
var ids = [];

function merge(a, b) {
    var r = a.slice(0);
    b.map(function(e) {
        if(r.indexOf(e) == -1) r.push(e);
    });
    return r;
}

function filterContent(list, ids) {
    for(var i = 0, len = list.length; i < len; i++) {
        var idx = list[i].childNodes()[1];
        var attr= idx.attr("data-root-id");
        if(ids.indexOf(attr.value()) != -1) {
            console.log("removed: " + attr.value());
            attr.remove(); // この行を消してはいけない。lxmljsのバグでGC時に死ぬ
            idx.remove();
        }
    }
}

function postIds(list) {
    var ids = [];
    
    for(var i = 0, len = list.length; i < len; i++) {
        var idx = list[i].get('./div');
        if(!idx) continue;
        console.log("added: "+idx.attr("data-root-id").value());
        ids.push(idx.attr("data-root-id").value());
    }
    return ids;
}

function convertIntoHTML5(txt) {
    txt = txt.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "");
    txt = txt.replace(/<script([^\/>]+(\/[^\/>]*)*)\/>/g, "<script$1></script>");
    txt = txt.slice(txt.indexOf('\n')+1);
    return txt
}

function scrape(body) {
    var xml = libxmljs.parseHtml(body);
    var lis = xml.find('//li[@class="post_container"]');
    filterContent(lis, ids);
    ids = merge(ids, postIds(lis));
    console.log("ids length:" + ids.length);
    return convertIntoHTML5(xml.toString());
}

function tumblrRequest(serverRequest, serverResponse, ajaxmode) {
    var requestUrl = url.parse(serverRequest.url);
    var buf = [];
    var gunzip = false;
    
    function requestCallback(response) {
        serverResponse.writeHead(response.statusCode, response.headers);
        response.on('data', function(chunk) {
            buf.push(chunk);
        });
        response.on('end', function() {
            zlib.gunzip(Buffer.concat(buf), function(err, body){
                if(!!err) {
                    console.log("tumblr decode error: "+err);
                    return;
                }
                var ret = "";
                if(ajaxmode) {
                    ret = scrape(body);
                } else {
                    body = body.toString();
                    var inline = body.slice(body.indexOf("<!-- START POSTS -->"), body.indexOf("<!-- END POSTS -->"))
                    ret = scrape(inline);
                    ret = body.replace(/<!-- START POSTS -->.*<!-- END POSTS -->/, ret);
                }
                console.log("hoge");
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
    var body = [];

    if(requestUrl.href.match(/http:\/\/www\.tumblr\.com\/dashboard(\/\d+)*$/)) {
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
