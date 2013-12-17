$(function() {
	var ce = chrome.extension;
	var bg_win = ce.getBackgroundPage();
	var PREFiX = bg_win.PREFiX;
	var lscache = bg_win.lscache;

	$('#switch-account').click(function(e) {
		PREFiX.reset();
		close();
	});
	$('#version').text(PREFiX.version);

	var current = PREFiX.settings.current;

	$('[key]').each(function() {
		var $item = $(this);
		var key = $item.attr('key');
		var value = current[key];
		switch ($item.attr('type')) {
			case 'checkbox':
				$item.prop('checked', value);
				break;
			case 'select':
			case 'text':
				$item.val(value);
				break;
			case 'range':
				$item.val(value + '');
				break;
		}
	});

	var $volume = $('#volume');
	$('[key="volume"]').on('change', function(e) {
		var volume = +$(this).val();
		$volume.text(parseInt(volume * 100, 10) + '%');
		PREFiX.settings.current.volume = volume;
	}).trigger('change');

	var $play_sound = $('[key="playSound"]');
	$play_sound.on('change', function(e) {
		var checked = $play_sound.prop('checked');
		$('[key="volume"]').prop('disabled', ! checked);
	}).trigger('change');

	$('#playSound').click(function(e) {
		bg_win.playSound(true);
	});

	var $tweets_per_page = $('#tweetsPerPage');
	$('[key="tweetsPerPage"]').on('change', function(e) {
		$tweets_per_page.text($(this).val());
	}).trigger('change');

	var $auto_flush_cache = $('[key="autoFlushCache"]');
	var $cache_amount = $('[key="cacheAmount"]');

	$auto_flush_cache.on('change', function(e) {
		var checked = $auto_flush_cache.prop('checked');
		$cache_amount.prop('disabled', ! checked);
	}).trigger('change');

	$cache_amount.on('change', function(e) {
		$('#cacheAmount').text($cache_amount.val());
	}).trigger('change');

	if (PREFiX.account) {
		$('#username').
		text(PREFiX.account.name + ' (@' + PREFiX.account.screen_name + ')').
		prop('href', 'https://twitter.com/' + PREFiX.account.screen_name);
	} else {
		$('#user-info').text('您还没有登录 Twitter 账号，请点击下面的按钮继续。')
		$('#switch-account').text('登入账号');
	}

	var last_used_page = lscache.get('last_used_page') || 0;
	$('#navbar li').each(function(i) {
		var $item = $(this);
		$item.click(function(e) {
			$('#navbar li').removeClass('current');
			$('.page').removeClass('current');
			$item.addClass('current');
			var page = $item.prop('id') + '-page';
			$('#' + page).addClass('current');
			lscache.set('last_used_page', i);
		});
	}).eq(last_used_page).click();

	var is_dual_consumer_enabled = !! lscache.get('sub_access_token');
	if (is_dual_consumer_enabled) {
		$('#dual-consumer-info').text('您已经启用了 Dual-Consumer. ');
		$('#toggle-dual-consumer').text('禁用 Dual-Consumer');
	}
	if (! PREFiX.account) {
		$('#toggle-dual-consumer').prop('disabled', 'true');
	}
	$('#toggle-dual-consumer').click(function(e) {
		if (! is_dual_consumer_enabled) {
			bg_win.getPinCode();
		} else {
			lscache.remove('sub_access_token');
			location.reload();
		}
	});

	var $usage_tip_list = $('#usage-tip-page ol').first();
	bg_win.usage_tips.forEach(function(tip) {
		var $li = $('<li />');
		$li.html(tip);
		$li.appendTo($usage_tip_list);
	});

	$('#status-count').text(bg_win.getStatusCount());
	$('#photo-count').text(bg_win.getPhotoCount());

	var install_time = lscache.get('install_time');
	install_time = bg_win.getMDY(install_time);
	$('#install-time').text(install_time);

	$('#show-updates').click(function(e) {
		var update = [];
		var history = bg_win.history;
		Object.keys(history).forEach(function(version) {
			update.push('# ' + version + ' #');
			update.push.apply(update, history[version]);
			update.push('');
		});
		alert(update.join('\n'));
	});

	onunload = function(e) {
		$('[key]').each(function() {
			var $item = $(this);
			var key = $item.attr('key');
			var value;
			switch ($item.attr('type')) {
				case 'checkbox':
					value = $item.prop('checked');
					break;
				case 'select':
				case 'text':
					value = $item.val();
					break;
				case 'range':
					value = +$item.val();
					break;
			}
			current[key] = value;
		});
		PREFiX.settings.save();
		PREFiX.settings.onSettingsUpdated();
	}
});