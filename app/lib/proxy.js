var fs = require("fs-extra");
var jimp = require("jimp");
var path = require('path');
var request = require('request');
var urlMod = require('url');
var readline = require('readline');
var minimatch = require('minimatch');
var url = require('url');

var utils = require('./utils.js');

var WHITELIST_FILE = path.join(__dirname, '/../../config', 'proxy_whitelist.txt');

var proxy = {};
module.exports = proxy;

var whitelistLoaded = false;
var whitelistLoading = false;
var proxyWhitelist = [];

proxy.addToProxyWhitelist = function(trustedURL, next) {
   checkProxyWhitelist(trustedURL, function(trusted) {
      if (trusted) {
         // If already trusted
         next();
      } else {
         // If not already trusted
         add();
      }
   });

   function add() {
      // Reload the whitelist to avoid overwriting any changes
      proxy.loadWhitelist(function() {
         trustedURL = url.parse(trustedURL);
         trustedURL.search = undefined;
         trustedURL.hash = undefined;

         proxyWhitelist.push(url.format(trustedURL));

         var file = fs.createWriteStream(WHITELIST_FILE);
         file.on('error', function(err) {
            // TODO
         });
         for (var i = 0; i < proxyWhitelist.length; i++) {
            file.write(proxyWhitelist[i] + '\n');
         }
         file.end();
         next();
      });
   }
};

proxy.loadWhitelist = function(next) {
   whitelistLoading = true;
   whitelistLoaded = false;
   proxyWhitelist = [];
   var rl = readline.createInterface({
      input: fs.createReadStream(WHITELIST_FILE)
   });

   rl.on('line', function(line) {
      proxyWhitelist.push(line);
   }).on('close', function() {
      whitelistLoaded = true;
      whitelistLoading = false;
      if (next) {
         next();
      }
   });
};

proxy.proxy = function(req, res) {
   var url = decodeURI(req.query.url); // Gets the given URL
   checkProxyWhitelist(url, function(trusted) {
      if (trusted) {
         request(url, function(err, response, body) {
            if (err) {
               utils.handleError(err, res);
            } else {
               res.status(response.statusCode);
               var content_type = response.headers['content-type'];
               if (content_type) {
                  if (content_type == "WMS_XML") { // TODO: see if there is a smaller brick to crack this walnut
                     content_type = "text/xml";
                  }
                  res.setHeader("content-type", content_type.split("; subtype=gml")[0]); // res.send has a tantrum if the subtype is GML!
               }
               res.send(body);
            }
         });
      } else {
         res.status(401).send();
      }
   });
};

proxy.img_proxy = function(req, res) {
   var url = decodeURI(req.query.url); // Gets the given URL
   checkProxyWhitelist(url, function(trusted) {
      if (trusted) {
         jimp.read(url, function(err, image) { // Gets the image file from the URL
            if (err) {
               utils.handleError(err, res);
            } else {
               image.getBuffer(jimp.MIME_PNG, function(err2, image2) { // Buffers the image so it sends correctly
                  if (err2) {
                     utils.handleError(err2, res);
                  } else {
                     res.setHeader('Content-type', 'image/png'); // Makes sure its a png
                     res.send(image2); // Sends the image to the browser.
                  }
               });
            }
         });
      } else {
         res.status(401).send();
      }
   });
};

proxy.rotate = function(req, res) {
   var angle = parseInt(req.query.angle); // Gets the given angle
   var url = req.query.url; // Gets the given URL
   checkProxyWhitelist(url, function(trusted) {
      if (trusted) {
         if (angle == "undefined" || angle === "" || typeof(angle) != "number") {
            angle = 0; // Sets angle to 0 if its not set to a number
         }
         angle = Math.round(angle / 90) * 90; // Rounds the angle to the neerest 90 degrees
         jimp.read(url, function(err, image) { // Gets the image file from the URL
            if (err) {
               utils.handleError(err, res);
            } else if (image) {
               image.rotate(angle); // Rotates the image *clockwise!*
               //image.resize( width, jimp.AUTO);
               image.getBuffer(jimp.MIME_PNG, function(err2, image2) { // Buffers the image so it sends correctly
                  if (err2) {
                     utils.handleError(err2, res);
                  } else {
                     res.setHeader('Content-type', 'image/png'); // Makes sure its a png
                     res.send(image2); // Sends the image to the browser.
                  }
               });
            } else {
               res.status(404).send();
            }
         });
      } else {
         res.status(401).send();
      }
   });
};

function checkProxyWhitelist(testUrl, next) {
   if (!whitelistLoaded) {
      if (!whitelistLoading) {
         // If not loaded and not loading, load it
         return proxy.loadWhitelist(function() {
            checkProxyWhitelist(testUrl, next);
         });
      } else {
         // If not loaded, but loading, try again after 10ms
         return setTimeout(function() {
            checkProxyWhitelist(testUrl, next);
         }, 10);
      }
   }

   testUrl = urlMod.parse(testUrl);
   testUrl.search = undefined;
   testUrl.hash = undefined;
   testUrl = urlMod.format(testUrl);

   var trusted = false;

   for (var i = 0; i < proxyWhitelist.length; i++) {
      if (minimatch(testUrl, proxyWhitelist[i])) {
         trusted = true;
         break;
      }
   }

   next(trusted);
}