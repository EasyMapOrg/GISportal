gisportal.panels = new EventManager();
gisportal.panels.defaultPanel = "choose-indicator";
gisportal.panels.activePanel = null;

gisportal.panels.initDOM = function() {

	$('.panel').on('click', '.js-show-panel', function() {
		gisportal.panels.showPanel($(this).data('panel-name'));
		

	});
	gisportal.panels.showPanel(gisportal.panels.defaultPanel);
};

gisportal.panels.showPanel = function(panelName) {
	gisportal.hideAllPopups();
	
	$('[data-panel-name="' + gisportal.panels.activePanel + '"]').removeClass('active');
	$('[data-panel-name="' + panelName + '"]').addClass('active');
	if (gisportal.panels.activePanel !== null) {
		gisportal.panels.trigger('close-panel', {
			"panel-name": gisportal.panels.activePanel
		});
	}
	if(gisportal.panels.activePanel == "choose-indicator" && $('#refine-layers')[0]){
		// Makes sure the ddslick is always open;
		$('#refine-layers').ddslick('close');
		$('#refine-layers').ddslick('open');
	}
	gisportal.panels.activePanel = panelName;
	gisportal.events.trigger('panels.showpanel', panelName);

};

gisportal.panels.bind('close-panel', function(ev, data) {

	if (data['panel-name'] === 'active-layers') {
		gisportal.events.trigger('metadata.close');
	}

});

// This produces a popup that takes a user input and runs it through a given function. recalls itself with a string_error boolean of true to display an error.
gisportal.panels.userFeedback = function(message, given_function, string_error){
	var popup = $('div.js-user-feedback-popup');
	popup.toggleClass('hidden', false);
	var html = $('div.js-user-feedback-html');
	var popup_content = gisportal.templates['user-feedback-popup']({"message":message, "function": given_function, "string_error":string_error});
	html.html(popup_content);
	$('.js-user-feedback-close').on('click', function(e) {
		e.preventDefault();
      $('div.js-user-feedback-popup').toggleClass('hidden', true);
      gisportal.events.trigger('userFeedback.close');
   });
	$('.js-user-feedback-submit').on('click', function(e) {
		e.preventDefault();
		var str = $('.user-feedback-input').val();
		if(/^[a-zA-Z _][a-zA-Z0-9 _]+$/.test(str) && str.length < 50){
			given_function(str);
	      $('div.js-user-feedback-popup').toggleClass('hidden', true);
	   }else{
	   	//error
	   	gisportal.panels.userFeedback(message, given_function, true);
	   }
      gisportal.events.trigger('userFeedback.submit');

   });
   $('.user-feedback-input').on('change keyup paste', function(e){
   	var value = $(this).val();
   	if(e.type == "paste"){
   		try{
         	value = e.originalEvent.clipboardData.getData('text/plain');
         }catch(err){}
      }
      gisportal.events.trigger('userFeedback.input', value);
   });

};