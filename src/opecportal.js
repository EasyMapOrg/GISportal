/**
 * Create opec namespace object
 * @namespace
 */ 
var opec = opec || (opec = {});

// Path to the flask middleware
opec.middlewarePath = '/service'; // <-- Change Path to match left hand side of WSGIScriptAlias

// Flask url paths
opec.wcsLocation = opec.middlewarePath + '/wcs2json/wcs?';
opec.wfsLocation = opec.middlewarePath + '/wfs2json/wfs?';

// Define a proxy for the map to allow async javascript http protocol requests
OpenLayers.ProxyHost = opec.middlewarePath + '/proxy?url=';   // Flask (Python) service OpenLayers proxy

// Stores the data provided by the master cache file on the server. This 
// includes layer names, titles, abstracts, etc.
opec.cache = {};
opec.cache.wmsLayers = [];
opec.cache.wfsLayers = [];

// Temporary version of microLayer and layer storage.
opec.layerStore = {};
opec.microLayers = {};

// A list of layer names that will be selected by default
// This should be moved to the middleware at some point...
opec.sampleLayers = ["metOffice: no3", "ogs: chl", "Motherloade: v_wind", "HiOOS: CRW_SST" ];

// Array of ALL available date-times for all date-time layers where data's available
// The array is populated once all the date-time layers have loaded
opec.enabledDays = [];

// Stores the current user selection. Any changes should trigger the correct event.
// Could be changed to an array later to support multiple user selections
opec.selection = {};
opec.selection.layer = undefined;
opec.selection.bbox = undefined;

opec.layerSelector = null;
/*===========================================================================*/
//Initialise javascript global variables and objects

/**
 * The OpenLayers map object
 * Soon to be attached to opec namespace
 */
var map;

// Predefined map coordinate systems - Needs to be moved at some point
var lonlat = new OpenLayers.Projection("EPSG:4326");

// Quick regions array in the format "Name",W,S,E,N - Needs to be moved at some point
var quickRegion = [
   ["Choose a Region",-150, -90, 150, 90],
   ["World View", -150, -90, 150, 90],
   ["European Seas", -23.44, 20.14, 39.88, 68.82],
   ["Adriatic", 11.83, 39.00, 20.67, 45.80],
   ["Baltic", 9.00, 51.08, 30.50, 67.62],
   ["Biscay", -10, 43.00, 0, 49.00],
   ["Black Sea", 27.30, 38.50, 42.00, 49.80],
   ["English Channel", -5.00, 46.67, 4.30, 53.83],
   ["Eastern Med.", 20.00, 29.35, 36.00, 41.65],
   ["North Sea", -4.50, 50.20, 8.90, 60.50],
   ["Western Med.", -6.00, 30.80, 16.50, 48.10],
   ["Mediterranean", -6.00, 29.35, 36.00, 48.10]  
];

/*===========================================================================*/

/**
 * Map function to get the master cache JSON files from the server and then 
 * start layer dependent code asynchronously
 */
opec.loadLayers = function() { 
   
   var errorHandling = function(request, errorType, exception) {
      var data = {
         type: 'master cache',
         request: request,
         errorType: errorType,
         exception: exception,
         url: this.url
      };  
      gritterErrorHandler(data); 
   };
    
   // Get WMS and WFS caches
   opec.genericAsyc('./cache/mastercache.json', opec.initWMSlayers, errorHandling, 'json', {}); 
   opec.genericAsyc('./cache/wfsMasterCache.json', opec.initWFSLayers, errorHandling, 'json', {});
};

opec.getFeature = function(layer, time) {
   
   var errorHandling = function(request, errorType, exception) {
      var data = {
         type: 'getFeature',
         request: request,
         errorType: errorType,
         exception: exception,
         url: this.url
      };  
      gritterErrorHandler(data); 
   };
  
   var featureID = layer.WFSDatesToIDs[time];   
   var updateLayer = function(data, opts) {
      var output = data.output;
      var pos = output.position.split(' ');
      var point = new OpenLayers.Geometry.Point(pos[1], pos[0]);
      var feature = new OpenLayers.Feature.Vector(point, {
         message: $('<div/>').html(output.content).html(),
         location: 'Lon: ' + pos[1] + ' Lat: ' + pos[0] 
      });
      layer.addFeatures(feature);
   };
   
   var params = {
      baseurl: layer.url,
      request: 'GetFeature',
      version: '1.1.0',
      featureID: featureID,
      typeName: layer.urlName
   };   
   var request = $.param(params);   
   
   opec.genericAsyc(opec.wfsLocation + request, updateLayer, errorHandling, 'json', {layer: layer}); 
};

/**
 * Generic Asyc Ajax to save having lots of different ones all over the place.
 * 
 * @param {string} url - The url to use as part of the ajax call
 * @param {Function} success - Called if everything goes ok.
 * @param {Function} error - Called if problems arise from the ajax call.
 * @param {string} dataType - What data type will be returned, xml, json, etc
 * @param {object} 
 */
opec.genericAsyc = function(url, success, error, dataType, opts) {
   //var map = this;
   $.ajax({
      type: 'GET',
      url: url, 
      dataType: dataType,
      asyc: true,
      cache: false,
      success: function(data) { success(data, opts); },
      error: error
   });
};

/**
 * Creates an opec.MicroLayer Object (layers in the selector but not yet map 
 * layers)
 * 
 * @constructor
 * @param {string} name - The layer name (unescaped)
 * @param {string} title - The title of the layer
 * @param {string} abstract - The abstract information for the layer
 * @param {string} firstDate - The first date for which data is available
 * @param {string} lastDate - The last date for which data is available
 * @param {string} serverName - The server name which serves the layer
 * @param {string} wmsURL - The URL for the WMS service
 * @param {string} wcsURL - The URL for the WCS service
 * @param {string} sensorName - The name of the sensor for this layer (unescaped)
 * @param {string} exBoundingBox - The geographic bounds for data in this layer
 */
opec.MicroLayer = function(name, title, productAbstract, firstDate, lastDate, 
   serverName, wmsURL, wcsURL, sensorName, exBoundingBox, providerTag) {
   
   this.id = name;      
   this.origName = name.replace("/","-");
   this.name = name.replace("/","-");
   this.urlName = name;
   this.displayTitle = title.replace(/_/g, " ");
   this.title = title;
   this.productAbstract = productAbstract;
   this.firstDate = firstDate;
   this.lastDate = lastDate;
   this.serverName = serverName;
   this.wmsURL = wmsURL;
   this.wcsURL = wcsURL;
   this.sensorNameDisplay = sensorName.replace(/\s+/g, "");
   this.sensorName = sensorName.replace(/[\.,]+/g, "");
   this.exBoundingBox = exBoundingBox;
   this.providerTag = providerTag;
};

/**
 * Create all the base layers for the map.
 */
opec.createBaseLayers = function() {
   //opec.leftPanel.addGroupToPanel('baseLayerGroup', 'Base Layers', $('#baseLayers'));
   
   function createBaseLayer(name, url, opts) {
      var layer = new OpenLayers.Layer.WMS(
         name,
         url,
         opts,
         { projection: lonlat, wrapDateLine: true, transitionEffect: 'resize' }      
      );
      layer.controlID = 'baseLayers';
      layer.displayTitle = name;
      layer.name = name;
      map.addLayer(layer);
      //opec.leftPanel.addLayerToGroup(layer, $('#baseLayerGroup'));
   }
   
   createBaseLayer('GEBCO', 'http://www.gebco.net/data_and_products/gebco_web_services/web_map_service/mapserv?', { layers: 'gebco_08_grid' });
   createBaseLayer('Metacarta Basic', 'http://labs.metacarta.com/wms/vmap0', { layers: 'basic' });
   createBaseLayer('Landsat', 'http://irs.gis-lab.info/?', { layers: 'landsat' });
   createBaseLayer('Blue Marble', 'http://demonstrator.vegaspace.com/wmspub', {layers: "BlueMarble" });
   
   // Get and store the number of base layers
   map.numBaseLayers = map.getLayersBy('isBaseLayer', true).length;
};

/**
 * Create all the reference layers for the map.
 */
opec.createRefLayers = function() {  
   opec.leftPanel.addGroupToPanel('refLayerGroup', 'Reference Layers', $('#opec-lPanel-reference'));
   
   $.each(opec.cache.wfsLayers, function(i, item) {
      if(typeof item.url !== 'undefined' && typeof item.serverName !== 'undefined' && typeof item.layers !== 'undefined') {
         var url = item.url;
         $.each(item.layers, function(i, item) {
            if (typeof item.name !== 'undefined' && typeof item.options !== 'undefined') {
               if(typeof item.options.passthrough !== 'undefined' && item.options.passthrough) {
                  item.style = new OpenLayers.StyleMap({
                     strokeColor: "#00FF00",
                     strokeOpacity: 1,
                     strokeWidth: 3
                  });
                  item.displayTitle = item.name;
                  createGMLLayer(item, url);
               }
               else {
                  createRefLayer(item, url);
               }
            }
         });
      } 
   });
   
   function createRefLayer(layer, url) {
      var wfsLayer = new OpenLayers.Layer.Vector(layer.name, { 
            //protocol: new OpenLayers.Protocol.WFS({
            //   version: '1.0.0',
            //   url: url,
            //   featureType: layer.name
               //featureid: function() { return this.WFSDatesToIDs[$('#viewDate').datepicker('getDate')]; }
            //}),
            projection: lonlat,
            styleMap: new OpenLayers.StyleMap({
               'default':{
                  strokeColor: "#00FF00",
                  strokeOpacity: 1,
                  strokeWidth: 3,
                  fillColor: "#FF5500",
                  fillOpacity: 0.5,
                  pointRadius: 6,
                  pointerEvents: "visiblePainted",             
                  fontSize: "12px",
                  fontFamily: "Courier New, monospace",
                  fontWeight: "bold",
                  labelOutlineColor: "white",
                  labelOutlineWidth: 3
               }
            }),
            eventListeners: {
               'featureselected': function(event) {
                  var feature = event.feature;
                  var popup = new OpenLayers.Popup.FramedCloud("popup",
                     OpenLayers.LonLat.fromString(feature.geometry.toShortString()),
                     null,
                     feature.attributes.message + "<br>" + feature.attributes.location,
                     null,
                     true,
                     null
                  );
                  popup.autoSize = true;
                  popup.maxSize = new OpenLayers.Size(400, 500);
                  popup.fixedRelativePosition = true;
                  feature.popup = popup;
                  map.addPopup(popup);
               },
               'featureunselected': function(event) {
                  var feature = event.feature;
                  map.removePopup(feature.popup);
                  feature.popup.destroy();
                  feature.popup = null;
               }
            }
         }, {
            typeName: layer.name, format: 'image/png', transparent: true, 
            exceptions: 'XML', version: '1.0', layers: '1'
         }
      ); 
      
      var selector = opec.mapControls.selector;
      var layers = selector.layers;
      
      if (typeof layers === 'undefined' || layers === null)
         layers = [];
      
      layers.push(wfsLayer);     
      opec.mapControls.selector.setLayer(layers);
      
      if (typeof layer.times !== 'undefined' && layer.times && layer.times.length) {
         wfsLayer.temporal = true;
         var times = [];
         var dateToIDLookup = {};
         for(var i = 0; i < layer.times.length; i++) {
            var time = layer.times[i];
            times.push(time.startdate);
            dateToIDLookup[time.startdate] = time.id;          
         }
         wfsLayer.DTCache = times;
         wfsLayer.WFSDatesToIDs = dateToIDLookup;
         //layer.firstDate = opec.utils.displayDateString(datetimes[0].startdate);
         //layer.lastDate = opec.utils.displayDateString(datetimes[datetimes.length - 1].startdate);
      }
   
      wfsLayer.urlName = layer.name.replace('-', ':');
      wfsLayer.id = layer.name;
      // Make this layer a reference layer
      wfsLayer.controlID = "refLayers";
      wfsLayer.setVisibility(false);
      wfsLayer.displayTitle = layer.name;
      wfsLayer.title = layer.name;
      wfsLayer.url = url;
      map.addLayer(wfsLayer);
      opec.leftPanel.addLayerToGroup(wfsLayer, $('#refLayerGroup'));
   }
   
   function createGMLLayer(layer, url) {
      var gmlLayer = new OpenLayers.Layer.Vector(layer.name, {
         protocol: new OpenLayers.Protocol.HTTP({
            url: url,
            format: new OpenLayers.Format.GML()
         }),
         strategies: [new OpenLayers.Strategy.Fixed()],
         projection: lonlat,
         styleMap: layer.style
      });

      // Make this layer a reference layer         
      gmlLayer.controlID = "refLayers";
      gmlLayer.setVisibility(false);
      gmlLayer.id = layer.name;
      gmlLayer.displayTitle = layer.displayTitle;
      gmlLayer.title = layer.displayTitle;
      map.addLayer(gmlLayer);
      opec.leftPanel.addLayerToGroup(gmlLayer, $('#refLayerGroup'));
   }
   
   var colourFunc = function(feature) {
      var colourLookup = {
         'AMT 12 track': 'blue',
         'AMT 13 track': 'aqua',
         'AMT 14 track': 'lime',
         'AMT 15 track': 'magenta',
         'AMT 16 track': 'red',
         'AMT 17 track': 'orange',
         'AMT 19 track': 'yellow'
      };
      
      if ($.inArray(feature, colourLookup))
         return colourLookup[feature.attributes.Name];
   };
   
   // Add AMT cruise tracks 12-19 as GML Formatted Vector layer
   for(var i = 12; i <= 19; i++) {
      // skip AMT18 as it isn't available
      if(i == 18) continue;
      // Style the AMT vector layers with different colours for each one
      var AMT_style = new OpenLayers.Style({
         'strokeColor': '${colour}'
      },
      {
         context: {
            colour: colourFunc
         }
      });
      
      var layer = {
         name: 'AMT' + i + '_Cruise_Track',
         displayTitle: 'AMT' + i + ' Cruise Track',
         // Create a style map object and set the 'default' and 'selected' intents
         style: new OpenLayers.StyleMap({ 'default': AMT_style })
      };
      
      createGMLLayer(layer, 'http://rsg.pml.ac.uk/geoserver/rsg/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=rsg:AMT' + i + '&outputFormat=GML2');
      
      /*
      var cruiseTrack = new OpenLayers.Layer.Vector('AMT' + i + '_Cruise_Track', {
         protocol: new OpenLayers.Protocol.HTTP({
            url: 'http://rsg.pml.ac.uk/geoserver/rsg/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=rsg:AMT' + i + '&outputFormat=GML2',
            format: new OpenLayers.Format.GML()
         }),
         strategies: [new OpenLayers.Strategy.Fixed()],
         projection: lonlat,
         styleMap: AMT_style_map
      });

      // Make this layer a reference layer         
      cruiseTrack.controlID = "refLayers";
      cruiseTrack.setVisibility(false);
      cruiseTrack.displayTitle = 'AMT' + i + ' Cruise Track';
      map.addLayer(cruiseTrack);
      opec.leftPanel.addLayerToGroup(cruiseTrack, $('#refLayerGroup')); */
   }

   // Setup Black sea outline layer (Vector)
   var blackSea = new OpenLayers.Layer.Vector('The_Black_Sea_KML', {
      projection: lonlat,
      strategies: [new OpenLayers.Strategy.Fixed()],
      protocol: new OpenLayers.Protocol.HTTP({
         url: 'black_sea.kml',
         format: new OpenLayers.Format.KML({
            extractStyles: true,
            extractAttributes: true
         })
      })
   });

   // Make this layer a reference layer
   blackSea.controlID = "refLayers";
   blackSea.selected = true;
   blackSea.id = 'The_Black_Sea_KML';
   blackSea.displayTitle = "The Black Sea (KML)";
   map.addLayer(blackSea);
   opec.leftPanel.addLayerToGroup(blackSea, $('#refLayerGroup'));

   // Get and store the number of reference layers
   map.numRefLayers = map.getLayersBy('controlID', 'refLayers').length;
};

/** 
 * Create MicroLayers from the getCapabilities request to 
 * be used in the layer selector.
 */
opec.createOpLayers = function() {
   $.each(opec.cache.wmsLayers, function(i, item) {
      // Make sure important data is not missing...
      if(typeof item.server !== "undefined" && 
      typeof item.wmsURL !== "undefined" && 
      typeof item.wcsURL !== "undefined" && 
      typeof item.serverName !== "undefined" && 
      typeof item.options !== "undefined") {
         var providerTag = typeof item.options.providerShortTag !== "undefined" ? item.options.providerShortTag : '';       
         var wmsURL = item.wmsURL;
         var wcsURL = item.wcsURL;
         var serverName = item.serverName;
         $.each(item.server, function(index, item) {
            if(item.length) {
               var sensorName = index;
               // Go through each layer and load it
               $.each(item, function(i, item) {
                  if(item.Name && item.Name !== "") {
                     var microLayer = new opec.MicroLayer(item.Name, item.Title, 
                        item.Abstract, item.FirstDate, item.LastDate, serverName, 
                        wmsURL, wcsURL, sensorName, item.EX_GeographicBoundingBox, providerTag);          
                     microLayer = opec.checkNameUnique(microLayer);   
                     opec.microLayers[microLayer.id] = microLayer;
                     opec.layerSelector.addLayer(opec.templates.selectionItem({
                        'id': microLayer.id,
                        'name': microLayer.name, 
                        'provider': providerTag, 
                        'title': microLayer.displayTitle, 
                        'abstract': microLayer.productAbstract
                     }));            
                     //$('#layers').multiselect('addItem', {text: providerTag + ': ' + microLayer.name, title: microLayer.displayTitle, selected: opec.isSelected});                
                  }
               });
            }
         });
      }
   });
   
   opec.layerSelector.refresh();
   // Batch add here in future.
   
};

/**
 * @param {Object} name - name of layer to check
 */
opec.isSelected = function(name) {
   if(map)
      return $.inArray(name, opec.sampleLayers) > -1 ? true : false;
};

/**
 * Checks if a layer name is unique recursively
 * 
 * @param {OPEC.MicroLayer} microLayer - The layer to check 
 * @param {number} count - Number of other layers with the same name (optional)
 */
opec.checkNameUnique = function(microLayer, count) {
   var id = null;
   
   if(typeof count === "undefined" || count === 0) {
      id = microLayer.id;
      count = 0;
   }
   else {
      id = microLayer.id + count;
   }
   
   if(id in opec.microLayers) {
      opec.checkNameUnique(microLayer, ++count);
   }
   else
      if(count !== 0) { 
         microLayer.id = microLayer.id + count; 
      }
      return microLayer;
};

/**
 * Create a layer to be displayed on the map.
 */ 
opec.createOpLayer = function(layerData, microLayer) {
   var layer = new OpenLayers.Layer.WMS (
      microLayer.providerTag + ': ' + microLayer.name,
      microLayer.wmsURL,
      { layers: microLayer.urlName, transparent: true}, 
      { opacity: 1, wrapDateLine: true, transitionEffect: 'resize' }
   );

   // Get the time dimension if this is a temporal layer
   // or elevation dimension
   $.each(layerData.Dimensions, function(index, value) {
      var dimension = value;
      if (value.Name.toLowerCase() == 'time') {
         layer.temporal = true;
         var datetimes = dimension.Value.split(',');
         layer.DTCache = datetimes;
         layer.firstDate = opec.utils.displayDateString(datetimes[0]);
         layer.lastDate = opec.utils.displayDateString(datetimes[datetimes.length - 1]);
      }
      else if (value.Name.toLowerCase() == 'elevation') {
         layer.elevation = true;
         layer.elevationCache = dimension.Value.split(',');
         layer.mergeNewParams({elevation: value.Default});
         layer.elevationDefault = value.Default;
         layer.elevationUnits = value.Units;
      }
   });

   layer.id = microLayer.id;
   layer.origName = microLayer.origName;
   layer.urlName = microLayer.urlName;
   layer.displayTitle = microLayer.displayTitle;
   layer.title = microLayer.title;
   layer.productAbstract = microLayer.productAbstract;
   layer.displaySensorName = microLayer.sensorNameDisplay;
   layer.sensorName = microLayer.sensorName;
   layer.wcsURL = microLayer.wcsURL;
   layer.styles = layerData.Styles;
   layer.exBoundingBox = microLayer.exBoundingBox;
   layer.boundingBox = layerData.BoundingBox;
   layer.setVisibility(false);     
   layer.selected = false;     
   opec.layerStore[layer.id] = layer;
   
   map.getMetadata(layer);
};

/**
 * Add a layer to the map from the layerStore. 
 */
opec.addOpLayer = function(layerID) {
   // Get layer from layerStore
   var layer = opec.layerStore[layerID];

   if (typeof layer === 'undefined' || layer == 'null') {
      // Error: Could not get a layer object
      console.log("Error: Could not get a layer object");
      return;
   }

   // Remove the layer from the layerStore
   delete opec.layerStore[layerID];
   
   // Check if an accordion is there for us
   //if(!$('#' + layer.displaySensorName).length)
      //opec.leftPanel.addGroupToPanel(layer.sensorName, layer.displaySensorName, $('#opec-lPanel-operational'));
   
   // Add the layer to the map
   map.addLayer(layer);
   map.setLayerIndex(layer, map.numBaseLayers + map.numOpLayers);
   
   map.events.register("click", layer, getFeatureInfo);

   // Add the layer to the panel
   opec.leftPanel.addLayerToGroup(layer, opec.leftPanel.getFirstGroupFromPanel($('#opec-lPanel-operational')));

   // Increase the count of OpLayers
   map.numOpLayers++;
};

/**
 * Remove a layer from the map and into the 
 * layerStore. 
 */
opec.removeOpLayer = function(layer) {
   // Remove the layer from the panel
   opec.leftPanel.removeLayerFromGroup(layer);
   
   // Check if we were the last layer
   //if($('#' + layer.displaySensorName).children('li').length == 0)
      //opec.leftPanel.removeGroupFromPanel(layer.displaySensorName);

   // Remove the layer from the map
   map.removeLayer(layer);
   
   map.events.unregister("click", layer, getFeatureInfo);

   // Add the layer to the layerStore
   opec.layerStore[layer.id] = layer;

   // Decrease the count of OpLayers
   map.numOpLayers--;
};

/**
 * Get a layer that has been added to the map by its id.
 * In future this function will return a generic opec layer
 * rather than a OpenLayers layer.
 */
opec.getLayerByID = function(id) {
   return map.getLayersBy('id', id)[0];
};

/**
 * Creates a list of custom args that will be added to the
 * permalink url.
 */
opec.customPermalinkArgs = function()
{
   var args = OpenLayers.Control.Permalink.prototype.createParams.apply(
      this, arguments
   );
};

/**
 * Checks to see if a layer is not visible and selected.
 */
opec.checkLayerState = function(layer) {
   if(!layer.visibility && layer.selected)
      $('#' + layer.id).find('img[src="img/exclamation_small.png"]').show();
   else
      $('#' + layer.id).find('img[src="img/exclamation_small.png"]').hide();
};

/**
 * Sets up the map, plus its controls, layers, styling and events.
 */
function mapInit() 
{
   map = new OpenLayers.Map('map', {
      projection: lonlat,
      displayProjection: lonlat,
      controls: []
   });
   
   map.setupGlobe(map, 'map', {
      is3D: false,
      proxy: '/service/proxy?url='
   });

   // Get both master cache files from the server. These files tells the server
   // what layers to load for Operation (wms) and Reference (wcs) layers.
   opec.loadLayers();

   // Create the base layers and then add them to the map
   opec.createBaseLayers();
   // Create the reference layers and then add them to the map
   //opec.createRefLayers();

   // Add a couple of useful map controls
   //var mousePos = new OpenLayers.Control.MousePosition();
   //var permalink =  new OpenLayers.Control.Permalink();
   //map.addControls([mousePos,permalink]);
   
   /* 
    * Set up event handling for the map including as well as mouse-based 
    * OpenLayers controls for jQuery UI buttons and drawing controls
    */
   
   // Create map controls identified by key values which can be activated and deactivated
   opec.mapControls = {
      zoomIn: new OpenLayers.Control.ZoomBox(
         { out: false, alwaysZoom: true }
      ),
      zoomOut: new OpenLayers.Control.ZoomBox(
         { out: true, alwaysZoom: true }
      ),
      pan: new OpenLayers.Control.Navigation(),
      selector: new OpenLayers.Control.SelectFeature([], {
         hover: false,
         autoActive: true
      })
   };

   // Add all the controls to the map
   for (var key in opec.mapControls) {
      var control = opec.mapControls[key];
      map.addControl(control);
   }

   if(!map.getCenter())
      map.zoomTo(3);
}

/**
 * Anything that needs to be done after the layers are loaded goes here.
 */ 
opec.initWMSlayers = function(data, opts) {
   opec.cache.wmsLayers = data;
   // Create WMS layers from the data
   opec.createOpLayers();
   
   //var ows = new OpenLayers.Format.OWSContext();
   //var doc = ows.write(map);
};

opec.initWFSLayers = function(data, opts) {
   opec.cache.wfsLayers = data;
   // Create WFS layers from the data
   opec.createRefLayers();
};

/*===========================================================================*/

/**
 * Loads anything that is not dependent on layer data. 
 */
function nonLayerDependent()
{
   // Keeps the vectorLayers at the top of the map
   map.events.register("addlayer", map, function() { 
       // Get and store the number of reference layers
      var refLayers = map.getLayersBy('controlID', 'refLayers');
      var poiLayers = map.getLayersBy('controlID', 'poiLayer');

      $.each(refLayers, function(index, value) {
         map.setLayerIndex(value, map.numBaseLayers + map.numOpLayers + index + 1);
      });

      $.each(poiLayers, function(index, value) {
         map.setLayerIndex(value, map.layers.length - 1);
      });
   });
   
   //----------------------------Quick Region----------------------------------

   // Handles re-set of the quick region selector after zooming in or out on the map or panning
   function quickRegionReset(e){
      $('#quickRegion').val('Choose a Region');
   }
   map.events.register('moveend', map, quickRegionReset);
   
   // Populate Quick Regions from the quickRegions array
   for(var i = 0; i < quickRegion.length; i++) {
       $('#quickRegion').append('<option value="' + i + '">' + quickRegion[i][0] + '</option>');
   }
   
   // Change of quick region event handler - happens even if the selection isn't changed
   $('#quickRegion').change(function(e) {
       var qr_id = $('#quickRegion').val();
       var bbox = new OpenLayers.Bounds(
                   quickRegion[qr_id][1],
                   quickRegion[qr_id][2],
                   quickRegion[qr_id][3],
                   quickRegion[qr_id][4]
                ).transform(map.displayProjection, map.projection);
       // Prevent the quick region selection being reset after the zoomtToExtent event         
       map.events.unregister('moveend', map, quickRegionReset);
       // Do the zoom to the quick region bounds
       map.zoomToExtent(bbox);
       // Re-enable quick region reset on map pan/zoom
       map.events.register('moveend', map, quickRegionReset);
   });
   
   //--------------------------------------------------------------------------
  
   //Configure and generate the UI elements
   
   // Setup the left panel
   opec.leftPanel.setup();
   
   // Setup the right panel
   opec.rightPanel.setup();
   
   //--------------------------------------------------------------------------
   
   // If the window is resized move dialogs to the center to stop them going of
   // the screen
   $(window).resize(function(event) {
      if(event.target == window) {
         $(".ui-dialog-content").extendedDialog("option", "position", "center");
      }
   });

   // set the max height of each of the accordions relative to the size of the window
   $('#layerAccordion').css('max-height', $(document).height() - 300);
   $('#opec-lPanel-operational').css('max-height', $(document).height() - 350);
   $('#opec-lPanel-reference').css('max-height', $(document).height() - 350);
   
   $(window).resize(function() {
      $('#layerAccordion').css('max-height', $(window).height() - 300);
      $('#opec-lPanel-operational').css('max-height', $(window).height() - 350);
      $('#opec-lPanel-reference').css('max-height', $(window).height() - 350);
   });
   
   //--------------------------------------------------------------------------

   // Handle selection of visible layers
   $('#opec-lPanel-content').on('mousedown', 'li', function(e) {
      var itm = $(this);
      if(!itm.hasClass('notSelectable')) {
         var child = itm.children('input').first();
         $('.opec-layer:visible').each(function(index) {
            $(this).removeClass('selectedLayer');
         });
         itm.addClass('selectedLayer');
         $(this).trigger('selectedLayer');
      }
   });
   
   // Toggle visibility of data layers
   $('#opec-lPanel-operational, #opec-lPanel-reference').on('click', ':checkbox', function(e) {
      var v = $(this).val();
      var layer = opec.getLayerByID(v);
      if($(this).is(':checked')) {
         layer.selected = true;
         // If the layer has date-time data, use special select routine
         // that checks for valid data on the current date to decide if to show data
         if(layer.temporal) {
            map.selectDateTimeLayer(layer, $('#viewDate').datepicker('getDate'));
            // Now display the layer on the timeline
            var startDate = $.datepicker.parseDate('dd-mm-yy', layer.firstDate);
            var endDate = $.datepicker.parseDate('dd-mm-yy', layer.lastDate);
            t1.addTimeBar(layer.id, layer.title, startDate, endDate, layer.DTCache);            
            // Update map date cache now a new temporal layer has been added
            map.refreshDateCache();
            $('#viewDate').datepicker("option", "defaultDate", $.datepicker.parseDate('dd-mm-yy', layer.lastDate));
         }
         else {
            layer.setVisibility(true);
            opec.checkLayerState(layer);
         }
      }
      else {
         layer.selected = false;
         layer.setVisibility(false);
         opec.checkLayerState(layer);
         if(layer.temporal) {
            // Remove the layer display on the timeline
            t1.removeTimeBarByName(layer.id);  
            // Update map date cache now a new temporal layer has been removed
            map.refreshDateCache();
         }
      }
   });

   // Update our latlng on the mousemove event
   map.events.register("mousemove", map, function(e) { 
      var position =  map.getLonLatFromPixel(e.xy);
      if(position)
         $('#latlng').text('Mouse Position: ' + position.lon.toPrecision(4) + ', ' + position.lat.toPrecision(4));
   });
   
   $('#mapInfo-Projection').text('Map Projection: ' + map.projection);

   // Populate the base layers drop down menu
   $.each(map.layers, function(index, value) {
       var layer = value;
       // Add map base layers to the baseLayer drop-down list from the map
       if(layer.isBaseLayer) {
           $('#baseLayer').append('<option value="' + layer.name + '">' + layer.name + '</option>');
       }
   });
   
   // jQuery UI elements
   $('#viewDate').datepicker({
      showButtonPanel: true,
      dateFormat: 'dd-mm-yy',
      changeMonth: true,
      changeYear: true,
      beforeShowDay: function(date) { return map.allowedDays(date); },
      onSelect: function(dateText, inst) {
         var thedate = new Date(inst.selectedYear, inst.selectedMonth, inst.selectedDay);
         // Synchronise date with the timeline
         t1.setDate(thedate);
         // Filter the layer data to the selected date
         map.filterLayersByDate(thedate);
      }
   });

   // Pan and zoom control buttons
   $('#panZoom').buttonset();
   $('#pan').button({ icons: { primary: 'ui-icon-arrow-4-diag'} });
   $('#zoomIn').button({ icons: { primary: 'ui-icon-circle-plus'} });
   $('#zoomOut').button({ icons: { primary: 'ui-icon-circle-minus'} });
   
   // Function which can toggle OpenLayers controls based on the clicked control
   // The value of the value of the underlying radio button is used to match 
   // against the key value in the mapControls array so the right control is toggled
   opec.toggleControl = function(element) {
      for(var key in opec.mapControls) {
         var control = opec.mapControls[key];
         if($(element).val() == key) {
            $('#'+key).attr('checked', true);
            control.activate();
            
            if(key == 'pan') {
               opec.mapControls.selector.activate();
            }
         }
         else {
            if(key != 'selector') {
               if(key == 'pan') {
                  opec.mapControls.selector.deactivate();
               }
               
               $('#'+key).attr('checked', false);
               control.deactivate();
            }
         }
      }
      $('#panZoom input:radio').button('refresh');
   };
   
   // Making sure the correct controls are active
   opec.toggleControl($('#panZoom input:radio'));

   // Manually Handle jQuery UI icon button click event - each button has a class of "iconBtn"
   $('#panZoom input:radio').click(function(e) {
      opec.toggleControl(this);
   });

   //--------------------------------------------------------------------------
   
   $('#opec-toolbar-actions')
      .buttonset().children('button:first')
      .button({ label: '', icons: { primary: 'ui-icon-opec-globe-info'} })
      .next().button({ label: '', icons: { primary: 'ui-icon-opec-globe-link'} })
      .next().next().button({ label: '', icons: { primary: 'ui-icon-opec-layers'} })
      .next().button({ label: '', icons: { primary: 'ui-icon-opec-globe'} })
      .click(function(e) {
         if(map.globe.is3D) {
            map.show2D();
         } 
         else {
            map.show3D();
            opec.gritter.showNotification('3DTutorial', null);
         }
      })
      .next().next().button({ label: '', icons: { primary: 'ui-icon-opec-info'} });
   
   // Add toggle functionality for dialogs
   addDialogClickHandler('#infoToggleBtn', '#info');
   addDialogClickHandler('#mapInfoToggleBtn', '#mapInfo');
   addDialogClickHandler('#layerPreloader', '#layerSelection');

   // Add permalink share panel click functionality
   $('#shareMapToggleBtn').click(function() {
      $('#shareOptions').toggle();
   });
   
   function addDialogClickHandler(idOne, idTwo) {
      $(idOne).click(function(e) {
         if($(idTwo).extendedDialog('isOpen')) {
           $(idTwo).extendedDialog('close');
         }
         else {
           $(idTwo).extendedDialog('open');
         }
         return false;
      });
   }
   
   //--------------------------------------------------------------------------
   
   // Change of base layer event handler
   $('#baseLayer').change(function(e) {
       map.setBaseLayer(opec.getLayerByID($('#baseLayer').val()));
   });

   // Setup the contextMenu
   opec.contextMenu.setup();
   
   // Setup timeline
   $.getJSON('timeline.json', function(data) { t1 = new opec.TimeLine('timeline', data); });
}

/*====================================================================================*/

/**
 * This code runs once the page has loaded - jQuery initialised.
 */
function main() {
   // Compile Templates
   opec.templates = {};
   opec.templates.layer = Mustache.compile($('#opec-template-layer').text().trim());
   opec.templates.metadataWindow = Mustache.compile($('#opec-template-metadataWindow').text().trim());
   opec.templates.scalebarWindow = Mustache.compile($('#opec-template-scalebarWindow').text().trim());
   opec.templates.graphCreatorWindow = Mustache.compile($('#opec-template-graphCreatorWindow').text().trim());
   opec.templates.selectionItem = Mustache.compile($('#opec-template-selector-item').text().trim());
   
   // Need to put this early so that tooltips work at the start to make the
   // page feel responsive.    
   //$(document).tooltip({
      //track: true,
      //position: { my: "left+10 center", at: "right center", collision: "flipfit" },
      //tooltipClass: 'ui-tooltip-info'
   //});
   
   //$(document).click(function() {
      //$(this).tooltip('close');
   //});
   
   /*
   $(document).on('mouseenter', '.tt', function() {
      $(this).tooltip({
         track: true,
         position: { my: "left+5 center", at: "right center", collision: "flipfit" }
      });
   }).on('mouseleave', '.tt', function() {
      $(this).tooltip('destroy');
   });*/
   
   // Need to render the jQuery UI info dialog before the map due to z-index issues!
   $('#info').extendedDialog({
      position: ['left', 'bottom'],
      width: 245,
      height: 220,
      resizable: false,
      showHelp: false,
      showMinimise: true,
      dblclick: "collapse"
   });

   // Show map info such as latlng
   $('#mapInfo').extendedDialog({
      position: ['center', 'center'],
      width: 220,
      height: 200,
      resizable: true,
      autoOpen: false,
      showHelp: false,
      showMinimise: true,
      dblclick: "collapse"
   });

   $('#opec-layerSelection').extendedDialog({
      position: ['center', 'center'],
      width: 550,
      minWidth:550,
      height: 400,
      minHeight: 400,
      resizable: true,
      autoOpen: true,
      showHelp: true,
      showMinimise: true,
      dblclick: "collapse",
      restore: function(e, dlg) {
         // Used to resize content on the dialog.
         $(this).trigger("resize");
      },
      help : function(e, dlg) {
         opec.gritter.showNotification('layerSelector', null);
      }
   });
   
   opec.layerSelector = new opec.window.layerSelector('opec-layerSelection .opec-tagMenu', 'opec-layerSelection .opec-selectable ul');

/*
   $('#layers').multiselect({
      selected: function(e, ui) {
         // DEBUG
         //console.log("selected");
         if(ui.option.text in opec.microLayers) {
            var microLayer = opec.microLayers[ui.option.text];

            if(ui.option.text in opec.layerStore) {
               // DEBUG
               //console.log("Adding layer...");
               opec.addOpLayer(ui.option.text);
               // DEBUG
               //console.log("Added Layer");
            }
            else
               map.getLayerData(microLayer.serverName + '_' + microLayer.origName + '.json', microLayer);
         }
         else {
            // DEBUG
            console.log("no layer data to use");
         }
      },
      deselected: function(e, ui) {
         // DEBUG
         //console.log("deselected");
         var layer = opec.getLayerByID(ui.option.text);

         if(layer) {
            // DEBUG
            //console.log("Removing layer...");
            opec.removeOpLayer(layer);
            // DEBUG
            //console.log("Layer removed");
         }
         else if(opec.layerStore[ui.option.text])
            layer = opec.layerStore[ui.option.text];
         else
            // DEBUG
            console.log("no layer data to use");
      },
      addall: function (that, func) {
         if(that.availableList.children('li.ui-element:visible').length > 50) {
            var warning = $('<div id="warning" title="You sure about this?"><p><span class="ui-icon ui-icon-alert" style="float: left; margin: 0 7px 50px 0;"></span>Adding lots of layers may cause the browser to slow down. Are you sure you want to proceed?</p></div>');
            $(document.body).append(warning);          
            $('#warning').extendedDialog({
               position: ['center', 'center'],
               width: 300,
               height: 200,
               resizable: false,
               autoOpen: true,
               modal: true,
               buttons: {
                  "Add Layers": function() {
                     $(this).extendedDialog("close");
                     func(that);
                  },
                  "Stop Adding Layers": function() {
                     $(this).extendedDialog("close");
                  }
               },
               close: function() {
                  // Remove on close
                  $('#warning').remove(); 
               }
            });
         }
         else
            func(that);
         
      }
   });*/
   
   /*
   $("#dThree").extendedDialog({
      position: ['center', 'center'],
      width: 1000,
      height: 600,
      resizable: false,
      autoOpen: true,
      showHelp: false,
      showMinimise: true,
      dblclick: "collapse"
   });
   
   addDThreeGraph();*/
   
   $(document.body).append('<div id="this-Is-A-Prototype" title="This is a prototype, be nice!"><p>This is a prototype version of the OPEC (Operational Ecology) Marine Ecosystem Forecasting portal and therefore may be unstable. If you find any bugs or wish to provide feedback you can find more info <a href="http://trac.marineopec.eu/wiki" target="_blank">here</a>.</p></div>');
   $('#this-Is-A-Prototype').extendedDialog({
      position: ['center', 'center'],
      width: 300,
      height: 230,
      resizable: false,
      autoOpen: true,
      modal: true,
      showHelp: false,
      buttons: {
         "Ok": function() {
            $(this).extendedDialog("close");
         }
      },
      close: function() {
         // Remove on close
         $('#this-Is-A-Prototype').remove(); 
      }
   });
   
   // Setup the gritter so we can use it for error messages
   opec.gritter.setup();

   // Set up the map
   // any layer dependent code is called in a callback in mapInit
   mapInit();

   // Start setting up anything that is not layer dependent
   nonLayerDependent();
}

// --------------------------------------------------------------------------------------------------
/**
 * Temporary used to get the value of a point back. Needed until WCS version is 
 * implemented. 
 * 
 * @param {Object} event
 */
function getFeatureInfo(event) {
   if(!this.visibility) return;
   
   var control = map.getControlsByClass("OpenLayers.Control.Navigation")[0];
   if(!control.active) return;
   
   var p = new OpenLayers.Pixel(event.xy.x, event.xy.y);
   var lonLat = map.getLonLatFromPixel(p);
   
   if(this.isBaseLayer) {
      // Do nothing yet...
   } else {
      if(typeof this.options.clickable !== 'undefined' && !this.options.clickable) return null;
      
      var maxp = new OpenLayers.Pixel(p.x + 10, p.y + 10),
         minp = new OpenLayers.Pixel(p.x - 10, p.y - 10),
         bbox = this.options.bbox;
         
      if(bbox && bbox.length > 0) bbox = bbox[0];
      
      var bounds = new OpenLayers.Bounds();
      if(!bbox) {
         
      } else if(bbox.lowercorner && bbox.uppercorner) {
         var lower = bbox.lowercorner.split(' '),
            upper = bbox.uppercorner.split(' ');
         bounds.extend(new OpenLayers.LonLat(lower[0], lower[1]));
         bounds.extend(new OpenLayers.LonLat(upper[0], upper[1]));
      } else if(bbox.maxx && bbox.maxy && bbox.minx && bbox.miny) {
         bounds.extend(new OpenLayers.LonLat(bbox.minx, bbox.miny));
         bounds.extend(new OpenLayers.LonLat(bbox.maxx, bbox.maxy));
      }
      
      var click_bounds = new OpenLayers.Bounds();
      click_bounds.extend(map.getLonLatFromPixel(maxp));
      click_bounds.extend(map.getLonLatFromPixel(minp));
      
      var minLL = map.getLonLatFromPixel(minp);
      var maxLL = map.getLonLatFromPixel(maxp);
      
      if(click_bounds.intersectsBounds(bounds) || !bbox) {
         
         // Immediately load popup saying "loading"
         var tempPopup = new OpenLayers.Popup(
            "temp", // TODO: does this need to be unique?
            lonLat,
            new OpenLayers.Size(100, 50),
            "Loading...",
            true, // Means "add a close box"
            null  // Do nothing when popup is closed.
         );
         tempPopup.autoSize = true;
         map.addPopup(tempPopup);
        
         bbox = maxLL.lat + ',' + minLL.lon + ',' + minLL.lat + ',' + maxLL.lon;
         var x = "",
            y = "";
         if(this.url.contains("1.0RC3")) {
            x = '&X=';
            y = '&Y=';
         } else {
            x = '&I=';
            y = '&J=';
         }  
            
         $.ajax({
            type: 'GET',
            url: OpenLayers.ProxyHost + 
               this.url + 
               encodeURIComponent(
                  'request=GetFeatureInfo' + 
                  '&service=wms' +
                  '&layers=' + this.urlName + 
                  '&QUERY_LAYERS=' + this.urlName + 
                  '&version=1.1.1' + 
                  '&bbox=' + map.getExtent().toBBOX() + 
                  '&time=' + this.params.TIME + 
                  '&elevation=' + this.params.ELEVATION + 
                  x + event.xy.x +
                  y + event.xy.y + 
                  '&SRS=EPSG:4326' + 
                  '&INFO_FORMAT=text/xml' +
                  '&WIDTH=' + map.size.w +
                  '&HEIGHT=' + map.size.h
               ),
            dataType: 'xml',
            asyc: true,
            success: function(data) {
               console.log(data);
               var xmldoc = data,
                  lon = parseFloat(getElementValue(xmldoc, 'longitude')),
                  lat = parseFloat(getElementValue(xmldoc, 'latitude')),
                  val = parseFloat(getElementValue(xmldoc, 'value')),
                  html = "";
                  
               if(lon && lat && val) {
                  var truncVal = val.toPrecision(4);
                  html = "<b>Lon:</b> " + lon.toFixed(6) + "<br /><b>Lat:</b> " +
                     lat.toFixed(6) + "<br /><b>Value:</b> " + truncVal + "<br />";
                     
                  //if(!isNaN(truncVal)) {
                     //html += '<a href="#" onclick=setColourScaleMin(' + val + ') ' +
                        //'title="Sets the minimum of the colour scale to ' + truncVal + '">' +
                        //'Set colour min</a><br />';
                     //html += '<a href="#" onclick=setColourScaleMax(' + val + ') ' +
                        //'title="Sets the maximum of the colour scale to ' + truncVal + '">' +
                        //'Set colour max</a><br />';
                  //}
               }
               
               // Remove the "Loading..." popup
               map.removePopup(tempPopup);
               // Show the result in a popup
               var popup = new OpenLayers.Popup (
                  "id", // TODO: does this need to be unique?
                  lonLat,
                  new OpenLayers.Size(100, 50),
                  html,
                  true, // Means "add a close box"
                  null  // Do nothing when popup is closed.
               );
               popup.autoSize = true;
               map.addPopup(popup);
            },
            error: function(request, errorType, exception) {
               var data = {
                  type: 'master cache',
                  request: request,
                  errorType: errorType,
                  exception: exception,
                  url: this.url
               };          
               gritterErrorHandler(data);
            }
         });
      }
   }
}

// Gets the value of the element with the given name from the given XML document,
// or null if the given element doesn't exist
function getElementValue(xml, elName)
{
    var el = xml.getElementsByTagName(elName);
    if (!el || !el[0] || !el[0].firstChild) return null;
    return el[0].firstChild.nodeValue;
}

// Sets the minimum value of the colour scale
function setColourScaleMin(scaleMin)
{
   // Do nothing
}

// Sets the minimum value of the colour scale
function setColourScaleMax(scaleMax)
{
   // Do nothing
}
// --------------------------------------------------------------------------------------------------

function addDThreeGraph() 
{
   var margin = {top: 20, right: 80, bottom: 30, left: 50},
      width = 960 - margin.left - margin.right,
      height = 500 - margin.top - margin.bottom;

   var parseDate = d3.time.format("%Y-%m-%dT%H:%M:%S").parse;
   
   var x = d3.time.scale()
      .range([0, width]);
   
   var y = d3.scale.linear()
      .range([height, 0]);
   
   var color = d3.scale.category10();
   
   var xAxis = d3.svg.axis()
      .scale(x)
      .orient("bottom");
   
   var yAxis = d3.svg.axis()
      .scale(y)
      .orient("left");
   
   var line = d3.svg.line()
      .interpolate("basis")
      .x(function(d) { return x(d.date); })
      .y(function(d) { return y(d.temperature); });
   
   var svg = d3.select("#dThree").append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
      .append("g")
      .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

   d3.tsv("data.tsv", function(error, data) {
      color.domain(d3.keys(data[0]).filter(function(key) { return key !== "date"; }));

      data.forEach(function(d) {
         d.date = parseDate(d.date);
      });
   
      var cities = color.domain().map(function(name) {
         return {
            name: name,
            values: data.map(function(d) {
               return {date: d.date, temperature: +d[name]};
            })
         };
      });
   
     x.domain(d3.extent(data, function(d) { return d.date; }));
   
     y.domain([
       d3.min(cities, function(c) { return d3.min(c.values, function(v) { return v.temperature; }); }),
       d3.max(cities, function(c) { return d3.max(c.values, function(v) { return v.temperature; }); })
     ]);
     
    svg.append("linearGradient")
      .attr("id", "temperature-gradient")
      .attr("gradientUnits", "userSpaceOnUse")
      .attr("x1", 0).attr("y1", y(10))
      .attr("x2", 0).attr("y2", y(20))
    .selectAll("stop")
      .data([
        {offset: "0%", color: "steelblue"},
        {offset: "50%", color: "gray"},
        {offset: "100%", color: "red"}
      ])
    .enter().append("stop")
      .attr("offset", function(d) { return d.offset; })
      .attr("stop-color", function(d) { return d.color; });
   
     svg.append("g")
         .attr("class", "x axis")
         .attr("transform", "translate(0," + height + ")")
         .call(xAxis);
   
     svg.append("g")
         .attr("class", "y axis")
         .call(yAxis)
       .append("text")
         .attr("transform", "rotate(-90)")
         .attr("y", 6)
         .attr("dy", ".71em")
         .style("text-anchor", "end")
         .text("Temperature (ºC)");
   
     var city = svg.selectAll(".city")
         .data(cities)
       .enter().append("g")
         .attr("class", "city");
   
     city.append("path")
         .attr("class", "line")
         .attr("d", function(d) { return line(d.values); })
         .style("stroke", function(d) { return color(d.name); });
   
     city.append("text")
         .datum(function(d) { return {name: d.name, value: d.values[d.values.length - 1]}; })
         .attr("transform", function(d) { return "translate(" + x(d.value.date) + "," + y(d.value.temperature) + ")"; })
         .attr("x", 3)
         .attr("dy", ".35em")
         .text(function(d) { return d.name; });
   });
}