
gisportal.graphs.jobs = [];



function getIndicatorDateRange( indicator ){
   indicator = gisportal.layers[indicator];
   
   var firstDate = new Date(indicator.firstDate);
   var lastDate = new Date(indicator.lastDate);
   
   return [ firstDate, lastDate ];
}


gisportal.templates = {};



gisportal.graphs.activePlotEditor = null;

/**
 * Adds a component to the active plot.
 * Create a plot and plot editor to the 
 * if one doesnt exist
 * 
 * @param Object component 
 */
gisportal.graphs.addComponentToGraph = function( component ){
   
   if( gisportal.graphs.activePlotEditor === null ){
      var Plot = gisportal.graphs.Plot;
      var plot = new Plot();
      gisportal.graphs.editPlot( plot );
      var plotType = "timeseries";
      if(gisportal.methodThatSelectedCurrentRegion.method == "csvUpload"){
         plotType = "profile";
      }
      plot.plotType( plotType );
      // These variables are set so that the correct drop downs are loaded in the first place.
      component.xText = "Left Axis";
      component.yText = "Right Axis";
   }else{
      component = gisportal.graphs.setComponentXYText(component, $('.js-active-plot-type').val() || "timeseries");
   }
   
   gisportal.panelSlideout.openSlideout( 'active-plot' );
   gisportal.graphs.activePlotEditor.addComponent( component );
};

// This sets the correct text for the dropdown depending on the selected graph
gisportal.graphs.setComponentXYText = function(component, plotType){
   switch(plotType){
      case "timeseries":
         component.xText = "Left Axis";
         component.yText = "Right Axis";
         break;
      default:
         component.xText = "X Axis";
         component.yText = "Y Axis";
         break;
   }
   return component;
};



/**
 * When a graph has finished, the active GraphEditor calls this function.
 * It will remove the editor
 * Setup a status object for the history panel
 * Close the editor slideout and show the history panel
 */
gisportal.graphs.activeGraphSubmitted = function(){
   var plot = gisportal.graphs.activePlotEditor.plot();
   gisportal.analytics.events.createGraph( plot );
   var plotStatus = new gisportal.graphs.PlotStatus( plot );
   var plotStatusElement = plotStatus.element();
   gisportal.graphs.graphsHistoryList.prepend( plotStatusElement );

   gisportal.graphs.activePlotEditor = null;
   $('.panel').removeClass('has-active-plot');

   gisportal.panelSlideout.closeSlideout( 'active-plot' );
   gisportal.panels.showPanel( 'history' );
};

/**
 * Removes the active graph. Deletes the data and closes the pane;
 */
gisportal.graphs.deleteActiveGraph = function(){
   gisportal.panelSlideout.closeSlideout( 'active-plot' );
   gisportal.graphs.activePlotEditor = null;
   $('.panel').removeClass('has-active-plot');
};

gisportal.graphs.initDOM = function() {
   
   gisportal.graphs.activePlotSlideout = $('.js-active-plot-slideout');

   gisportal.graphs.statesSavedList = $('.js-states-saved-list');

   gisportal.graphs.graphsHistoryList = $('.js-graphs-history-list');
   gisportal.graphs.graphsSavedList = $('.js-graphs-saved-list');
   gisportal.graphs.popup.addActionListeners();
   
};

/**
 * Open a plot in the editor.
 * Warn the user if they are going to delete an existing the graph
 */
gisportal.graphs.editPlot = function( plot ){
   //If the user is editing a graph
   // Warn them first
   if( gisportal.graphs.activePlotEditor !== null )
      if( confirm( "This will delete your current plot" ) === false )
         return false;

   var PlotEditor = gisportal.graphs.PlotEditor;
   var plotEditor = new PlotEditor( plot, $('.js-active-plot-slideout') );
   $('.panel').addClass('has-active-plot');
   gisportal.graphs.activePlotEditor = plotEditor;
   gisportal.panelSlideout.openSlideout( 'active-plot' );
};

gisportal.graphs.popup = {};
gisportal.graphs.popup.addActionListeners = function(){
   $('span.js-plot-popup-close').on('click', function(){
      $('div.js-plot-popup').toggleClass('hidden', true);
   });
};

gisportal.graphs.popup.loadPlot = function(html){
   var popup_content = gisportal.templates['plot-popup']({html:html});
   $('.js-plot-popup').html(popup_content);
   $('.js-plot-popup').toggleClass("hidden", false);
   gisportal.graphs.popup.addActionListeners();
};