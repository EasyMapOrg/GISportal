/**
 * Create opec namespace object
 * @namespace
 */ 
var opec = opec || (opec = {});

/*===========================================================================*/
//Initialise javascript variables and objects

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
opec.layerStore = {}; // NOT IN USE!

opec.microLayers = {};
opec.layers = {};
opec.selectedLayers = {};
opec.nonSelectedLayers = {};

// A list of layer names that will be selected by default
// This should be moved to the middleware at some point...
opec.sampleLayers = ["metOffice: no3", "ogs: chl", "Motherloade: v_wind", "HiOOS: CRW_SST" ];

// Array of ALL available date-times for all date-time layers where data's available
// The array is populated once all the date-time layers have loaded
opec.enabledDays = [];

// Used as offsets when sorting layers in groups
opec.numBaseLayers = 0;
opec.numRefLayers = 0;
opec.numOpLayers = 0;

// Stores the current user selection. Any changes should trigger the correct event.
// Could be changed to an array later to support multiple user selections
opec.selection = {};
opec.selection.layer = undefined;
opec.selection.bbox = undefined;

opec.layerSelector = null;
opec.timeline = null;

// Predefined map coordinate systems
opec.lonlat = new OpenLayers.Projection("EPSG:4326");

/**
 * The OpenLayers map object
 * Soon to be attached to opec namespace
 */
var map;

// Quick regions array in the format "Name",W,S,E,N - TODO: Needs to be moved at some point
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

opec.getFeature = function(layer, olLayer, time) {
   
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
      olLayer.addFeatures(feature);
   };
   
   var params = {
      baseurl: layer.wfsURL,
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
 * Create all the base layers for the map.
 */
opec.createBaseLayers = function() {
   //opec.leftPanel.addGroupToPanel('baseLayerGroup', 'Base Layers', $('#baseLayers'));
   
   function createBaseLayer(name, url, opts) {
      var layer = new OpenLayers.Layer.WMS(
         name,
         url,
         opts,
         { projection: opec.lonlat, wrapDateLine: true, transitionEffect: 'resize' }      
      );
      
      layer.id = name;
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
 * WARNING: Horrible monster function. TODO: Refactor.
 */
opec.createRefLayers = function() {  
   opec.leftPanel.addGroupToPanel('refLayerGroup', 'Reference Layers', $('#opec-lPanel-reference'));
   
   $.each(opec.cache.wfsLayers, function(i, item) {
      if(typeof item.url !== 'undefined' && typeof item.serverName !== 'undefined' && typeof item.layers !== 'undefined') {
         var url = item.url;
         var serverName = item.serverName;
         $.each(item.layers, function(i, item) {
            if(typeof item.name !== 'undefined' && typeof item.options !== 'undefined') {
               item.productAbstract = "None Provided";
               item.tags = {};
               
               var microLayer = new opec.MicroLayer(item.name, item.name, 
                     item.productAbstract, "refLayers", {
                        "serverName": serverName, 
                        "wfsURL": url, 
                        "providerTag": item.options.providerShortTag,
                        "tags": item.tags,
                        "options": item.options,
                        "times" : item.times
                     }
               );
                     
               microLayer = opec.checkNameUnique(microLayer);   
               opec.microLayers[microLayer.id] = microLayer;
               opec.layerSelector.addLayer(opec.templates.selectionItem({
                     'id': microLayer.id,
                     'name': microLayer.name, 
                     'provider': item.options.providerShortTag, 
                     'title': microLayer.displayTitle, 
                     'abstract': microLayer.productAbstract
                  }), {'tags': microLayer.tags
               }); 
            }
         });
      } 
   });
   
   opec.layerSelector.refresh();
   
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
      }, {
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
      
      opec.createGMLLayer(layer, 'http://rsg.pml.ac.uk/geoserver/rsg/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=rsg:AMT' + i + '&outputFormat=GML2');
   }

   // Setup Black sea outline layer (Vector)
   var blackSea = new OpenLayers.Layer.Vector('The_Black_Sea_KML', {
      projection: opec.lonlat,
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

opec.createGMLLayer = function(layer, url) {
   var gmlLayer = new OpenLayers.Layer.Vector(layer.name, {
      protocol: new OpenLayers.Protocol.HTTP({
         url: url,
         format: new OpenLayers.Format.GML()
      }),
      strategies: [new OpenLayers.Strategy.Fixed()],
      projection: opec.lonlat,
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
                        item.Abstract, "opLayers", { 
                           "firstDate": item.FirstDate, 
                           "lastDate": item.LastDate, 
                           "serverName": serverName, 
                           "wmsURL": wmsURL, 
                           "wcsURL": wcsURL, 
                           "sensor": sensorName, 
                           "exBoundingBox": item.EX_GeographicBoundingBox, 
                           "providerTag": providerTag, 
                           "tags": item.tags
                        }
                     );
                               
                     microLayer = opec.checkNameUnique(microLayer);   
                     opec.microLayers[microLayer.id] = microLayer;
                     opec.layerSelector.addLayer(opec.templates.selectionItem({
                           'id': microLayer.id,
                           'name': microLayer.name, 
                           'provider': providerTag, 
                           'title': microLayer.displayTitle, 
                           'abstract': microLayer.productAbstract
                        }), 
                        {'tags': microLayer.tags
                     });                         
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
 * Get a layer that has been added to the map by its id.
 * In future this function will return a generic opec layer
 * rather than a OpenLayers layer.
 */
opec.getLayerByID = function(id) {
   //return map.getLayersBy('id', id)[0];
   return opec.layers[id];
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
   } else {
      id = microLayer.id + count;
   }
   
   if(id in opec.microLayers) {
      opec.checkNameUnique(microLayer, ++count);
   } else {
      if(count !== 0) { 
         microLayer.id = microLayer.id + count; 
      }
   }
   
   return microLayer;
};

/**
 * Returns availability (boolean) of data for the given JavaScript date for all layers.
 * Used as the beforeshowday callback function for the jQuery UI current view date DatePicker control
 * 
 * @param {Date} thedate - The date provided by the jQuery UI DatePicker control as a JavaScript Date object
 * @return {Array.<boolean>} Returns true or false depending on if there is layer data available for the given date
 */
opec.allowedDays = function(thedate) {
   var uidate = opec.utils.ISODateString(thedate);
   // Filter the datetime array to see if it matches the date using jQuery grep utility
   var filtArray = $.grep(opec.enabledDays, function(dt, i) {
      var datePart = dt.substring(0, 10);
      return (datePart == uidate);
   });
   // If the filtered array has members it has matched this day one or more times
   if(filtArray.length > 0) {
      return [true];
   }
   else {
      return [false];
   }
};

/**
 * Map function to re-generate the global date cache for selected layers.
 */
opec.refreshDateCache = function() {
   var map = this;
   opec.enabledDays = [];
   
   $.each(map.layers, function(index, value) {
      var layer = value;
      if(layer.selected && layer.temporal) {
         opec.enabledDays = opec.enabledDays.concat(layer.DTCache);
      }
   });
   
   opec.enabledDays = opec.utils.arrayDeDupe(opec.enabledDays);  
   console.info('Global date cache now has ' + opec.enabledDays.length + ' members.'); // DEBUG
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
 * Sets up the map, plus its controls, layers, styling and events.
 */
opec.mapInit = function() {
   map = new OpenLayers.Map('map', {
      projection: opec.lonlat,
      displayProjection: opec.lonlat,
      controls: []
   });
   
   //map.setupGlobe(map, 'map', {
      //is3D: false,
      //proxy: '/service/proxy?url='
   //});

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
};

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
opec.nonLayerDependent = function()
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
   
   //--------------------------------------------------------------------------
  
   //Configure and generate the UI elements
   
   // Setup the left panel
   opec.leftPanel.setup();
   
   // Setup the right panel
   opec.rightPanel.setup();
   
   // Setup the topbar
   opec.topbar.setup();
   
   //--------------------------------------------------------------------------
   
   // If the window is resized move dialogs to the center to stop them going of
   // the screen
   $(window).resize(function(event) {
      if(event.target == window) {
         $(".ui-dialog-normal").extendedDialog("option", "position", "center");
      }
   });

   // Set the max height of each of the accordions relative to the size of the window
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
         layer.select();
         
      } else {
         layer.unselect();
      }
   });
   
   //--------------------------------------------------------------------------

   // Update our latlng on the mousemove event
   map.events.register("mousemove", map, function(e) { 
      var position =  map.getLonLatFromPixel(e.xy);
      if(position)
         $('#latlng').text('Mouse Position: ' + position.lon.toPrecision(4) + ', ' + position.lat.toPrecision(4));
   });
   
   $('#mapInfo-Projection').text('Map Projection: ' + map.projection);
   
   //--------------------------------------------------------------------------

   // Populate the base layers drop down menu
   $.each(map.layers, function(index, value) {
       var layer = value;
       // Add map base layers to the baseLayer drop-down list from the map
       if(layer.isBaseLayer) {
           $('#baseLayer').append('<option value="' + layer.name + '">' + layer.name + '</option>');
       }
   });
   
   // Change of base layer event handler
   $('#baseLayer').change(function(e) {
       map.setBaseLayer(opec.getLayerByID($('#baseLayer').val()));
   });
     
   //--------------------------------------------------------------------------

   // Setup the contextMenu
   opec.contextMenu.setup();
   
   // Setup timeline
   opec.timeline = new opec.TimeLine('timeline', {
      comment: "Sample timeline data",
      selectedDate: new Date("2006-06-05T00:00:00Z"),
      chartMargins: {
         top: 7,
         right: 0,
         bottom: 5,
         left: 0
      },
      barHeight: 20,
      barMargin: 2,
      timebars: [] 
   });
};

/*====================================================================================*/

/**
 * This code runs once the page has loaded - jQuery initialised.
 */
opec.main = function() {
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
   opec.mapInit();

   // Start setting up anything that is not layer dependent
   opec.nonLayerDependent();
};

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