(function() {
	var params = location.search.split('&');
	if (params.indexOf('appname=PREFiX') === -1)
		return;
	var $form = $('#oauth_form');
	var data = { };
	var arr_data = $form.serializeArray();
	arr_data.forEach(function(item) {
		data[item.name] = item.value;
	});
	$.ajax({
		url: $form.attr('action'),
		type: 'POST',
		data: data
	}).always(function(jqXHR) {
		var html = jqXHR.responseText;
		if (! html) return;
		var re = /<code>(\d+)<\/code>/i;
		var result = html.match(re);
		if (result) {
			var pin_code = result[1];
			chrome.runtime.sendMessage({
				act: 'send_pincode',
				code: pin_code
			});
			close();
		}
	});
})();
