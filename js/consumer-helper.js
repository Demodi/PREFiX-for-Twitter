var $set = $('<input />');
$set.prop('type', 'button');
$set.prop('value', '设置 PREFiX 尾巴');
$set.addClass('form-submit');
$set.css('margin', '0');
$set.click(function(e) {
	var consumer_key, consumer_secret;
	var access_token, access_token_secret;
	var access_level;
	$('tr').each(function() {
		var $tds = $(this).find('td');
		var $td_1 = $tds.first();
		var $td_2 = $tds.last();
		var name = $td_1.text().trim();
		var value = $td_2.text().trim();

		switch (name) {
		case 'Consumer key':
			consumer_key = value;
			break;
		case 'Consumer secret':
			consumer_secret = value;
			break;
		case 'Access token':
			access_token = value;
			break;
		case 'Access token secret':
			access_token_secret = value;
			break;
		case 'Access level':
			access_level = value;
			break;
		}
	});
	if (! consumer_key || ! consumer_secret)
		return;
	if (! access_token || ! access_token_secret) {
		alert('请点击本页面下方的 "Create my access token" 按钮后重试. ');
		return;
	}
	if (access_level !== 'Read, write, and direct messages') {
		var msg = '请确认您在 Settings 页面设置了 ';
		msg += 'Read, Write and Access direct messages 访问权限, ';
		msg += '然后点击 Recreate my access token 后重试. ';
		alert(msg);
		return;
	}
	chrome.runtime.sendMessage({
		act: 'set_sub_consumer',
		consumer: {
			key: key,
			secret: secret
		},
		access_token: {
			token: access_token,
			secret: access_token_secret
		}
	});
});
var $p = $('<p />');
$p.append($set);
var $form = $('<form />');
$form.append($p);
if (location.pathname !== '/apps') {
	$('.app-details').append($form);
}