var ce = chrome.extension;
var bg_win = ce.getBackgroundPage();
var Ripple = bg_win.Ripple;
var Deferred = bg_win.Deferred;
var lscache = bg_win.lscache;
var jEmoji = bg_win.jEmoji;
var PREFiX = bg_win.PREFiX;

var $body;
var $app;
var $textarea;
var $main;

var is_panel_mode = false;
var $scrolling_elem;

var last_model = PREFiX.current;

var is_windows = navigator.platform.indexOf('Win') > -1;

var loading = false;
var is_on_top = true;
PREFiX.popupActive = true;
PREFiX.is_popup_focused = true;

var lyric;

if (! PREFiX.user()) {
	bg_win.initialize();
	close();
}

var usage_tips = bg_win.usage_tips;

function setViewHeight(height) {
	lscache.set('popup_view_height', Math.round(Math.max(600, height)));
	applyViewHeight();
}

function applyViewHeight() {
	var height = getViewHeight();
	$('body, #picture-overlay, #context-timeline, #drop-area').height(height);
	$main.height(height - parseInt($main.css('top'), 10));
}

var goTop = (function() {
	var s = 0;
	var current;
	var id;
	var stop = function() { };
	return function(e) {
		stopSmoothScrolling();
		stop();
		stop = function() {
			stop = function() { };
			cancelAnimationFrame(id);
		}
		if (e) {
			e.preventDefault && e.preventDefault();
			s = $main[0].scrollTop;
		}
		var breakpoint;
		id = requestAnimationFrame(function(timestamp) {
			if (breakpoint) {
				var diff = (timestamp - breakpoint) * 1.2;
				current = $main[0].scrollTop;
				if (s != current) {
					return stop();
				}
				var to = Math.floor(s / 1.15 / Math.max(1, diff / 32));
				$main[0].scrollTop = s = to;
			}
			if (s >= 1 || ! breakpoint) {
				breakpoint = timestamp;
				id = requestAnimationFrame(arguments.callee);
			};
		});
	}
})();

var registered_smooth_scroll_data = [];
function initSmoothScroll($target) {
	var id;
	var is_scrolling = false;
	var destination = null;
	var _stop = function() { };
	function runAnimation(dest) {
		if (dest !== undefined) {
			destination = Math.round(dest);
		}
		function renderFrame(timestamp) {
			if (! is_scrolling) return;

			if (breakpoint) {
				var progress = (timestamp - breakpoint) * 1.2;

				var pos = $target.scrollTop();
				var diff = destination - pos;
				var dist = Math.round(Math.min(1, progress / 32) * diff / 4);
				dist = dist || Math.abs(diff) / diff;

				var min_pos = 0;
				var max_pos = $target[0].scrollHeight - height;
				var this_pos = Math.max(min_pos, pos + dist);
				this_pos = Math.min(this_pos, max_pos);

				$target.scrollTop(this_pos);

				diff = destination - this_pos;
				if (! diff || [ min_pos, max_pos ].indexOf(this_pos) > -1) {
					return _stop();
				}
			}


			breakpoint = timestamp;
			id = requestAnimationFrame(renderFrame);
		}
		if (is_scrolling) return;
		var height = $target.height();
		is_scrolling = true;
		var breakpoint;
		id = requestAnimationFrame(renderFrame);
		_stop = function() {
			_stop = function() { };
			if ($target === $main) {
				stopSmoothScrolling = _stop;
			}
			destination = null;
			is_scrolling = false;
			cancelAnimationFrame(id);
		}
		if ($target === $main) {
			stopSmoothScrolling = _stop;
		}
	}
	$target.on('mousewheel', function(e, delta) {
		if (! PREFiX.settings.current.smoothScroll && e.flag !== true)
			return;
		e.preventDefault();
		destination = destination || $target.scrollTop();
		destination = Math.ceil(-delta * 120 + destination);
		runAnimation();
	});
	registered_smooth_scroll_data.push({
		elem: $target[0],
		run: runAnimation
	});
}
function stopSmoothScrolling() { }
function smoothScrollTo(destination) {
	registered_smooth_scroll_data.forEach(function(item) {
		if (item.elem === $scrolling_elem[0]) {
			item.run(destination);
		}
	});
}

function findView(model, id) {
	if (id) {
		return model.$elem.find('[data-id=' + id + ']');
	} else {
		return model.$elem.children().first();
	}
}

function findModel(model, id) {
	var list = model.tweets || model.messages;
	var model_found;
	if (id) {
		list.some(function(item) {
			if (item.id_str === id) {
				model_found = item;
				return true;
			}
		});
	}
	return model_found || list[0];
}

function setCurrent(model, id) {
	var now = Date.now();
	var canceled = false;
	var $view;
	waitFor(function() {
		$view = findView(model, id);
		if (Date.now() - now > 5000) {
			canceled = true;
		}
		return $view.length || canceled;
	}, function() {
		if ($view.length) {
			model.current = id;
			model.$elem.children().removeClass('current');
			model.$elem.find('a.focused').removeClass('focused');
			$view.addClass('current');
		}
	});
}

function initKeyboardControl() {
	var model = getCurrent();
	var list = model.tweets || model.messages;
	waitFor(function() {
		return list.length;
	}, function() {
		if (! model.current) {
			model.current = list[0].id_str;
		}
		setCurrent(model, model.current);
	});
}

function initKeyboardControlEvents() {
	var min_pos = 0;
	min_pos += parseInt($main.css('top'), 10);
	min_pos += $('#title').height();
	$main.delegate('[data-id]', 'mouseenter', function(e) {
		setCurrent(getCurrent(), e.currentTarget.getAttribute('data-id'));
	});
	$(window).keydown(function(e) {
		if (e.ctrlKey || e.altKey || e.metaKey) return;
		switch (e.keyCode) {
			case 72 /* H */: case 74 /* J */:
			case 75 /* K */: case 76 /* L */:
				e.preventDefault();
				break;
			default:
				return;
		}
		var current_model = getCurrent();
		var current_id = current_model.current;
		var $current_view = findView(current_model, current_id);
		var is_context_tl = !! $('body.show-context-timeline').length;
		var is_photo = !! $('body.show-picture').length;
		if (is_context_tl || is_photo) {
			var key_matched = 0;
			switch (e.keyCode) {
				case 72:
					key_matched = 36;
					break;
				case 74:
					key_matched = 40;
					break;
				case 75:
					key_matched = 38;
					break;
				case 76:
					key_matched = 35;
					break;
			}
			if (key_matched) {
				$(window).trigger({
					type: 'keydown',
					keyCode: key_matched
				});
			}
			return;
		}

		if (e.keyCode === 72) {
			var list = current_model.tweets || current_model.messages;
			target = 0;
			if ($scrolling_elem === $main) {
				if ($main.scrollTop() === 0) {
					PREFiX.update();
					cutStream();
				}
				setCurrent(current_model, list[0].id_str);
			}
		} else if (e.keyCode === 74) {
			var $next_view = $current_view.nextAll('li[data-id]').first();
			if (! $next_view.length) return;
			var delta = $next_view.offset().top;
			var current_pos = $main.scrollTop();
			var height = $current_view.height();
			var next_view_height = $next_view.height();
			var target = Math.max(current_pos + height, delta + current_pos - $body.height() + next_view_height);
			setCurrent(current_model, $next_view.attr('data-id'));
		} else if (e.keyCode === 75) {
			var $pre_view = $current_view.prevAll('li[data-id]').first();
			if (! $pre_view.length) return;
			var delta = $pre_view.offset().top;
			var current_pos = $main.scrollTop();
			var height = $pre_view.height();
			var target = Math.min(current_pos - height, delta + current_pos - min_pos);
			target = Math.max(target, current_pos + delta + height - $body.height());
			setCurrent(current_model, $pre_view.attr('data-id'));
		} else if (e.keyCode === 76) {
			var list = current_model.tweets || current_model.messages;
			target = $main[0].scrollHeight - $main.height();
			setCurrent(current_model, list[list.length - 1].id_str);
		}
		smoothScrollTo(target);
	}).keydown(function(e) {
		if (e.ctrlKey || e.altKey || e.metaKey) return;

		if (e.keyCode === 27 /* Esc */) {
			if ($scrolling_elem !== $main) {
				e.keyCode = 32;
			}
		}

		switch (e.keyCode) {
			case 8 /* Backspace*/:
			case 68 /* D */: case 70 /* F */:
			case 77 /* M */: case 78 /* N */:
			case 81 /* Q */: case 83 /* S */:
			case 84 /* T */: case 85 /* U */:
				if ($scrolling_elem !== $main)
					return;

			case 82 /* R */:
				if ($('body.show-context-timeline').length)
					return;

			case 8 /* Backspace*/:
			case 32 /* Space */:
			case 67 /* C */: case 70 /* F */:
			case 77 /* M */: case 78 /* N */:
			case 80 /* P */: case 81 /* Q */:
			case 82 /* R */: case 83 /* S */:
			case 85 /* U */: case 86 /* V */:
			case 84 /* T */:
				e.preventDefault();
				break;
			default:
				return;
		}

		var current_model = getCurrent();
		var $view = findView(current_model, current_model.current);
		var current = findModel(current_model, current_model.current);

		if (e.keyCode === 8) {
			$('#back').click();
		} else if (e.keyCode === 32 && ! e.shiftKey) {
			if ($scrolling_elem !== $main) {
				hideAllOverlays(e);
			} else {
				$textarea.focus();
				if (compose-bar.type === 'repost') {
					$textarea[0].selectionStart = 0;
					$textarea[0].selectionEnd = 0;
				}
			}
		} else if (e.keyCode === 67) {
			if ($('body.show-context-timeline').length) {
				$('#context-timeline').trigger('click');
			} else {
				$view.find('.context').click();
			}
		} else if (e.keyCode === 68 && e.shiftKey) {
			var $remove = $view.find('a.remove');
			if ($remove.length) {
				var event = new Event('dblclick');
				$remove[0].dispatchEvent(event);
			}
		} else if (e.keyCode === 70) {
			var $fav = $view.find('a.favourite');
			if (e.shiftKey && current.favorited) {
				$fav[0].click();
			} else if (! e.shiftKey && ! current.favorited) {
				$fav[0].click();
			}
		} else if (e.keyCode === 77) {
			var $focused_link = $view.find('.tweet-content a.focused');
			if ($focused_link.length) {
				$focused_link.removeClass('focused');
				var $prev = $focused_link.prev('a');
				if (! $prev.length) {
					$prev = $view.find('.tweet-content a').last();
				}
				$prev.addClass('focused');
			} else {
				var $links = [].slice.call($view.find('.tweet-content a')).reverse();
				if (! $links.length) return;
				$($links[0]).addClass('focused');
			}
		} else if (e.keyCode === 78) {
			var $focused_link = $view.find('.tweet-content a.focused');
			if ($focused_link.length) {
				$focused_link.removeClass('focused');
				var $next = $focused_link.next('a');
				if (! $next.length) {
					$next = $view.find('.tweet-content a').first();
				}
				$next.addClass('focused');
			} else {
				var $links = [].slice.call($view.find('.tweet-content a'));
				if (! $links.length) return;
				$($links[0]).addClass('focused');
			}
		} else if (e.keyCode === 80) {
			if (is_panel_mode) return;
			$('#new-window').click();
		} else if (e.keyCode === 81) {
			var $repost = $view.find('a.repost');
			if ($repost.length) {
				var event = new Event('contextmenu');
				$repost[0].dispatchEvent(event);
			}
		} else if (e.keyCode === 82) {
			if ($('body.show-picture').length) {
				rotatePicture();
				return;
			}
			var $reply = $view.find('a.reply');
			if ($reply.length) {
				$reply[0].click();
			}
		} else if (e.keyCode === 83) {
			if (e.shiftKey) {
				var $avatar = $view.find('.avatar a');
				$avatar.trigger({
					type: 'click',
					shiftKey: true
				});
			} else {
				var $name = $view.find('.name');
				$name.trigger('click');
			}
		} else if (e.keyCode === 84) {
			var $repost = $view.find('a.repost');
			if ($repost.length) {
				if ((! current.retweeted && ! e.shiftKey) ||
					(current.retweeted && e.shiftKey)) {
					$repost[0].click();
				}
			}
		} else if (e.keyCode === 85) {
			var $link = $view.find('a.permanent-link');
			$link.trigger({
				type: 'click',
				shiftKey: e.shiftKey
			});
		} else if (e.keyCode === 86) {
			if ($('body.show-picture').length) {
				hidePicture();
			} else if (! e.shiftKey) {
				$view.find('.photo img').click();
			}
			if (e.shiftKey) {
				$view.find('.photo img').trigger({
					type: 'contextmenu',
					shiftKey: e.shiftKey
				});
			}
		}
	}).keydown(function(e) {
		if (e.ctrlKey || e.metaKey || e.altKey)
			return;
		if (e.keyCode !== 13) return;
		var current_model = getCurrent();
		var $view = findView(current_model, current_model.current);
		var $focused_link = $view.find('a.focused');
		if (! $focused_link.length) return;
		$focused_link.removeClass('focused').trigger({
			type: 'click',
			shiftKey: e.shiftKey
		});
		e.preventDefault();
		e.stopPropagation();
	});
}

var showNotification = (function() {
	var timeout;
	return function(text) {
		clearTimeout(timeout);
		$('#notification').text(text).css({
			display: 'inline-block',
			opacity: 0,
			'margin-top': '15px'
		}).animate({
			opacity: 1,
			'margin-top': '0px'
		});
		timeout = setTimeout(function() {
			$('#notification').fadeOut();
		}, 5000);
	}
})();

function showUsageTip() {
	if ($main[0].scrollTop) {
		setTimeout(showUsageTip, 100);
		return;
	}
	var pos = lscache.get('usage_tip_pos') || 0;
	pos = Math.min(pos, usage_tips.length);
	var tip = usage_tips[pos];
	var $usage_tip = $('#usage-tip');
	if (tip === undefined) {
 		$usage_tip.remove();
 		return;
 	}
	lscache.set('usage_tip_pos', ++pos);
	if (! tip) return;
	$('#hide-usage-tip').click(function(e) {
		lscache.set('usage_tip_pos', usage_tips.length);
		$title.removeClass('show-usage-tip');
	});
	lscache.set('usage_tip_pos', ++pos);
	$('#usage-tip-content').html(tip);
	var $title = $('#title');
	$title.addClass('show-usage-tip');
	var width = $usage_tip.width();
	var delta = width - $body.width() + 25;
	if (delta > 0) {
		setTimeout(function() {
			$usage_tip.css('margin-left', 0).
			animate({
				'margin-left': -delta + 'px'
			}, 3000);
		}, 3000);
	}
	setTimeout(function() {
		$title.removeClass('show-usage-tip');
		$usage_tip.animate({
			'margin-left': 0
		}, 100);
	}, 15000);
}

function count(e) {
	var length = computeLength(composebar_model.text);
	$app.toggleClass('over', length > 140);
}

function setContent(content) {
	composebar_model.text = content.trim().replace(/\s+/g, ' ');
	count();
}

function getCurrent() {
	return window[PREFiX.current];
}

var last_draw_attention = new Date;
function drawAttention() {
	if (! is_panel_mode || PREFiX.is_popup_focused) return;
	var now = new Date;
	if (now - last_draw_attention < 3000) return;
	last_draw_attention = now;
	setTimeout(function() {
		chrome.runtime.sendMessage({
			act: 'draw_attention'
		});
	}, 0);
}

function stopDrawingAttention() {
	chrome.runtime.sendMessage({
		act: 'stop_drawing_attention'
	});
}

function updateRelativeTime() {
	var current = getCurrent();
	if (! current || (! current.tweets && ! current.messages))
		return;
	(current.tweets || current.messages).forEach(function(t) {
		t.relativeTime = t.created_at && getRelativeTime(t.created_at);
		var retweeted = t.retweeted_status;
		if (retweeted) {
			retweeted.relativeTime = retweeted.created_at && getRelativeTime(retweeted.created_at);
		}
	});
}

var breakpoints = [];
function markBreakpoint() {
	breakpoints.push(Date.now());
}

function createTab(url, active) {
	chrome.tabs.create({
		url: url,
		active: active === true
	});	
}

function confirmFollowing() {
	PREFiX.user().follow({ screen_name: 'ruif' }).next(function() {
		showNotification('感谢关注 :)');
	});
	hideFollowingTip();
}

function denyFollowing() {
	hideFollowingTip();
}

function hideFollowingTip() {
	$('#follow-author').css({
		'animation-name': 'wobbleOut',
		'animation-duration': 400
	}).delay(400).hide(0, function() {
		$(this).remove();
		lscache.set('hide-following-tip', true);
	});
}

function showRatingPage() {
	var url = 'https://chrome.google.com/webstore/detail/prefix/dcmnjbgdfjhikldahhhjhccnnpjlcodg/reviews';
	createTab(url, true);
	hideRatingTip();
}

function showRatingTip() {
	$('#rating-tip').show();
}

function hideRatingTip() {
	$('#rating-tip').css({
		'animation-name': 'wobbleOut',
		'animation-duration': 400
	}).delay(400).hide(0, function() {
		$(this).remove();
		lscache.set('hide-rating-tip', true);
	});
}

function sendDM(id, name) {
	composebar_model.text = '';
	composebar_model.type = 'send-dm';
	composebar_model.id = '';
	composebar_model.user = id;
	composebar_model.screen_name = name;
	focusToEnd();
}

function accumulateTime() {
	var time = lscache.get('timer') || 0;
	time++;

	if (time >= 600) {
		clearInterval(rating_interval);
		showRatingTip();
	}

	lscache.set('timer', time);
}

function focusToEnd() {
	$textarea.focus();
	var pos = composebar_model.text.length;
	$textarea[0].selectionStart = $textarea[0].selectionEnd = pos;
}

function resetHeader() {
	$('#back').css('animation', 'leftOut .4s both');
	$('h1').css('animation', 'topIn .4s both');
}

function deleteTweetFromAllLists(tweet_id) {
	var lists = [
		tl_model.tweets,
		mentions_model.tweets,
		PREFiX.homeTimeline.buffered,
		PREFiX.homeTimeline.tweets,
		PREFiX.mentions.buffered,
		PREFiX.mentions.tweets
	];
	lists.forEach(function(list) {
		var index = -1;
		list.some(function(tweet, i) {
			if (tweet.id_str === tweet_id) {
				index = i;
				return true;
			}
		});
		if (index > -1) {
			list.splice(index, 1);
		}
	});
}

function hideAllOverlays(e) {
	if ($('body.show-picture').length) {
		e.preventDefault();
		hidePicture();
	} else if ($('body.show-context-timeline').length) {
		e.preventDefault();
		$('#context-timeline').trigger('click');
	}
}

function setImage(file) {
	$textarea.css('text-indent', file ? '30px' : '');
	var size;
	if (file) {
		size = computeSize(file.size);
	}
	if (file && file.size > 2 * 1024 * 1024) {
		var msg = '您的图片文件大小 (' + size + ') 超过 2MB, 上传可能会失败.' +
			' 确定要继续吗?';
		if (! confirm(msg)) return;
	}
	var $upload = $('#uploading-photo');
	var title = '上传图片';
	if (file) {
		title = '取消上传 ' + file.name + ' (' +
			size + ')';
			$textarea.focus();
	}
	$upload.prop('title', title);
	$upload.toggleClass('file-selected', !! file);
	PREFiX.image = file;
	$textarea[0].focus();
	$textarea[0].blur();
	if (file) {
		$textarea.focus();
	}
}

function initMainUI() {
	$body = $('body');
	$app = $('#app');

	if (navigator.platform.indexOf('Linux') > -1) {
		$('html').attr('platform', 'linux');
	} else if (PREFiX.is_mac) {
		$('html').attr('platform', 'mac');
	} else if (is_windows) {
		$('html').attr('platform', 'win');
	}

	var ratio = +PREFiX.settings.current.zoomRatio;
	if (ratio !== 1 && is_panel_mode) {
		$body.css('zoom', ratio);
		$('<link />').
		prop('rel', 'stylesheet').
		prop('href', 'css/retina.css').
		appendTo('head');
		if (ratio > 1.4) {
			$('h2').css('letter-spacing', '.5px');
		}
	}

	if (! lscache.get('hide-following-tip')) {
		$('#confirm-following').click(confirmFollowing);
		$('#deny-following').click(denyFollowing);
		PREFiX.user().getUser({ screen_name: 'ruif' }).next(function(user) {
			if (user.following) denyFollowing();
		});
	} else {
		$('#follow-author').remove();
	}

	$(window).on('focus', function(e) {
		PREFiX.is_popup_focused = true;
		stopDrawingAttention();
		markBreakpoint();
		bg_win.hideAllNotifications();
	}).on('blur', function(e) {
		PREFiX.is_popup_focused = false;
	});

	$textarea = $('#compose-bar textarea');
	$textarea.autosize().atwho({
		at: '@',
		data: PREFiX.friends,
		search_key: 'string',
		tpl: '<li data-value="${screen_name}">${name} (@${screen_name})</li>'
	}).keydown(function(e) {
		if (! this.value && e.keyCode === 32 &&
			! (e.shiftKey || e.ctrlKey || e.metaKey)) {
			e.stopPropagation();
			e.preventDefault();
			$textarea.blur();
		}
	});

	function showDropArea(e) {
		if (! e) return;
		e = e.originalEvent || e;
		var items = e.dataTransfer.items;
		var is_file = [].slice.call(items).some(function(item) {
			if (item.kind === 'file' &&
				item.type.match(/^image\//)) {
				return true;
			}
		});
		if (! is_file) return;
		$body.addClass('show-drop-area');
	}

	function hideDropArea(e) {
		if (e && e.target !== $('#drop-area')[0]) return;
		$body.removeClass('show-drop-area');
	}

	$app.on({
		dragenter: showDropArea,
		dragover: function(e) {
			e.stopPropagation();
			e.preventDefault();
			showDropArea(e);
		},
		dragleave: hideDropArea,
		drop: function(e) {
			e = e.originalEvent;

			e.stopPropagation();
			e.preventDefault();

			hideDropArea();

			var file = e.dataTransfer.files[0];
			if (! file || ! isImage(file.type))
				return;

			if (file.type === 'image/png') {
				fixTransparentPNG(file).next(function(blob) {
					setImage(blob);
				});
			} else {
				setImage(file);
			}
		}
	});

	$('#uploading-photo').click(function(e) {
		if (! PREFiX.image) {
			if (! is_panel_mode && ! is_windows) {
				$('#new-window').click();
			}
			return;
		}
		setImage(null);
		var $copy = $file.clone(true);
		$file.replaceWith($copy);
		$file = $copy;
	});

	var $file = $('#file');
	$file.on('change', function(e) {
		var file = $(this)[0].files[0];
		if (! file || ! isImage(file.type))
			return;
		if (file.type === 'image/png') {
			fixTransparentPNG(file).next(function(blob) {
				setImage(blob);
			});
		} else {
			setImage(file);
		}
	});

	if (! is_windows && ! is_panel_mode) {
		$file.hide();
	}

	$(window).on('paste', function(e) {
		var e = e.originalEvent;
		var items = e.clipboardData.items;
		if (! items.length) return;
		var f, i = 0;
		while (items[i]) {
			f = items[i].getAsFile();
			if (f && isImage(f.type))	{
				break;
			}
			i++;
		}
		if (! f) return;
		f.name = 'image-from-clipboard.' + f.type.replace('image/', '');
		if (file.type === 'image/png') {
			fixTransparentPNG(f).next(function(blob) {
				setImage(f);
			});
		} else {
			setImage(f);
		}
	});

	setImage(PREFiX.image);

	$main = $scrolling_elem = $('#main');

	$main[0].onscroll = function(e) {
		this.scrollLeft = 0;
	}

	$main.scroll(_.throttle(function(e) {
		var scroll_top = $main.scrollTop();
		getCurrent().scrollTop = scroll_top;
		$app.toggleClass('on-top', scroll_top === 0);
		if (scroll_top + $main.height() >= $main[0].scrollHeight - ($main[0].clientHeight/2))
			loadOldder();
		if (scroll_top < 30)
			markBreakpoint();
	}, 100));

	$('#app').delegate('a', 'click', function(e) {
		if (e.currentTarget.href.indexOf('http://') !== 0 &&
			e.currentTarget.href.indexOf('https://') !== 0)
			return;
		e.preventDefault();
		e.stopPropagation();
		if (! e.currentTarget.dataset.userid || e.shiftKey) {
			createTab(e.currentTarget.href, e.shiftKey);
		}
	}).delegate('[data-userid]', 'click', function(e) {
		if (e.shiftKey) return;
		PREFiX.userid = this.dataset.userid;
		nav_model.showUserTimeline();
	}).delegate('span.context', 'click', function(e) {
		var $tweet = $(e.currentTarget).parents('li');
		var tweet_id = $tweet.attr('data-id');
		var model = getCurrent();
		var tweet;
		model.tweets.some(function(t) {
			if (t.id_str === tweet_id) {
				tweet = t;
				return true;
			}
		});
		showRelatedTweets.call(tweet, e);
	}).delegate('[data-hashtag]', 'click', function(e) {
		e.preventDefault();
		e.stopPropagation();
		var keyword = $(e.target).attr('data-hashtag');
		searches_model.search_keyword = decodeURIComponent(keyword);
		$('#navigation-bar .saved-searches').trigger('click');
	}).delegate('.photo img', 'contextmenu', function(e) {
		var large_url = e.target.dataset.largeImg;
		if (large_url) {
			e.preventDefault();
			createTab(large_url, e.shiftKey);
		}
	}).delegate('.photo img', 'click', function(e) {
		showPicture(e.target.dataset.largeImg);
	}).delegate('#picture', 'contextmenu', function(e) {
		e.preventDefault();
		createTab(e.target.src, e.shiftKey);
		hidePicture();
	}).delegate('#stream .info', 'mouseenter', function(e) {
		var $info = $(e.currentTarget);
		var original_width = $info.width();
		$info.css('position', 'absolute');
		var full_width = $info.width() + 95;
		$info.css('position', '');
		if (full_width <= original_width) return;
		e.currentTarget.scrolling = true;
		var scrolled = 0;
		var direction;
		function scroll() {
			if (! e.currentTarget.scrolling) return;
			var scrolled_end = scrolled === (full_width - original_width);
			var scrolled_start = direction && ! scrolled;
			e.currentTarget.timeout = setTimeout(scroll, scrolled_end || scrolled_start ? 1500: 20);
			if (scrolled_end) {
				direction = 1;
			} else if (scrolled === 0) {
				direction = -1;
			}
			scrolled += -direction;
			$info.css('text-indent', '-' + scrolled + 'px');
		}
		scroll();
	}).delegate('#stream .info', 'mouseleave', function(e) {
		var $info = $(e.currentTarget);
		$info.css('text-indent', 0);
		clearTimeout(e.currentTarget.timeout);
		e.currentTarget.scrolling = false;
	}).delegate('#relationship', 'click', function(e) {
		var $this = $(e.currentTarget);
		if ($this.text() === '关注 TA') {
			PREFiX.user().follow({
				user_id: PREFiX.userid
			}).next(function(user) {
				$this.text(user.following ? '已关注' : '已发出关注请求');
				$this.prop('title', '取消关注');
			});
		} else if ($this.text() === '已关注') {
			PREFiX.user().unfollow({
				user_id: PREFiX.userid
			}).next(function(user) {
				$this.text('关注 TA').prop('title', '');
			})
		}
	});

	$('#back').click(function(e) {
		if (last_model === 'usertl_model') {
			last_model = 'tl_model';
		}
		$main.scrollTop(0);
		setTimeout(function() {
			resetHeader();
			PREFiX.current = nav_model.current = last_model;
			window[last_model].initialize();
		});
	});

	$('h1').click(function(e) {
		if ($main[0].scrollTop) {
			goTop(e);
		}
		if ($main[0].scrollTop < 30) {
			if (PREFiX.current === 'searches_model') {
				$('#topic-selector').trigger('change');
			} else {
				cutStream();
				PREFiX.update();
			}
		}
	});

	$('#new-window').click(function(e) {
		createPopup();
		close();
	});

	$('#picture-overlay').click(function(e) {
		hidePicture();
	});

	$('#context-timeline').click(function(e) {
		if (! $(e.target).is('a') && ! $(e.target).is('img')) {
			$(this).removeClass('focusInFromBottom').addClass('focusOutFromTop');
			setTimeout(function() {
				$scrolling_elem = $main;
				$('body').removeClass('show-context-timeline');
			}, 250);
			if (showRelatedTweets.ajax) {
				showRelatedTweets.ajax.cancel();
			}
		}
	});
	
	$('#context-timeline ul').click(function(e) {
		if (! $(e.target).is('a') && ! $(e.target).is('img'))
			e.stopPropagation();
	});

	composebar_model.type = PREFiX.compose.type;
	composebar_model.id = PREFiX.compose.id;
	composebar_model.user = PREFiX.compose.user;
	composebar_model.screen_name = PREFiX.compose.screen_name;
	composebar_model.text = PREFiX.compose.text;
	if (PREFiX.compose.text) {
		focusToEnd();
	}

	[ $main, $('#context-timeline'), $('#picture-overlay') ].forEach(initSmoothScroll);

	$(window).on('keydown', function(e) {
		var $link;
		switch (e.keyCode) {
			case 49:
				$link = $('#navigation-bar .home-timeline');
				break;
			case 50:
				$link = $('#navigation-bar .mentions');
				break;
			case 51:
				$link = $('#navigation-bar .directmsgs');
				break;
			case 52:
				$link = $('#navigation-bar .saved-searches');
				break;
			default:
				return;
		}
		e.preventDefault();
		var event = new Event('click');
		$link[0].dispatchEvent(event);
	}).on('keydown', function(e) {
		if ($(e.target).is('select'))
			return;
		switch (e.keyCode) {
			case 40: case 38:
				break;
			default:
				return;
		}
		e.preventDefault();
		var page_height = innerHeight / ratio;
		if ($scrolling_elem === $main) {
			page_height -= parseInt($main.css('top'), 10);
		}
		var current_pos = $scrolling_elem.scrollTop();
		var direction = e.keyCode === 40 ? -1 : 1;
		$scrolling_elem.trigger('mousewheel', direction);
	}).on('keydown', function(e) {
		if (e.keyCode !== 36) return;
		if ($scrolling_elem === $main)
			goTop(e);
		else
			smoothScrollTo(0);
	}).on('keydown', function(e) {
		if (e.keyCode !== 35) return;
		e.preventDefault();
		var full_height = $scrolling_elem[0].scrollHeight;
		var page_height = $scrolling_elem[0].clientHeight;
		var destination = full_height - page_height;
		if ($scrolling_elem.scrollTop() < destination)
			smoothScrollTo(destination);
	}).on('keydown', function(e) {
		switch (e.keyCode) {
			case 34: case 33:
				break;
			default:
				return;
		}
		e.preventDefault();
		var current_pos = $scrolling_elem.scrollTop();
		var height = $scrolling_elem.height();
		smoothScrollTo(e.keyCode === 34 ?
			current_pos + height : current_pos - height);
	}).on('keydown', function(e) {
		if (e.keyCode !== 116) return;
		e.preventDefault();
		PREFiX.update();
	});

	tl_model.$elem = $('#home-timeline');
	mentions_model.$elem = $('#mentions');
	directmsgs_model.$elem = $('#directmsgs');
	searches_model.$elem = $('#saved-searches');
	usertl_model.$elem = $('#user-timeline');

	resetLoadingEffect();

	setInterval(updateRelativeTime, 15000);
	setInterval(checkCount, 100);

	if (! lscache.get('hide-rating-tip')) {
		window.rating_interval = setInterval(accumulateTime, 60000);
		accumulateTime();
		$('#show-rating-page').click(showRatingPage);
		$('#hide-rating-tip').click(hideRatingTip);
	} else {
		$('#rating-tip').remove();
	}
}

function cutStream() {
	var current = getCurrent();
	var tweets_per_page = PREFiX.settings.current.tweetsPerPage;
	if (current.tweets) {
		current.tweets = current.tweets.slice(0, tweets_per_page);
		current.current = current.tweets[0].id_str;
	} else {
		current.messages = current.messages.slice(0, tweets_per_page);
		current.current = current.messages[0].id_str;
	}
	current.allLoaded = false;
}

function computePosition(data, no_minus_left) {
	var left = parseInt(($body[0].clientWidth - data.width) / 2, 10);
	var top = parseInt(($body[0].clientHeight - data.height) / 2, 10);
	if (no_minus_left) {
		data.left = Math.max(0, left);
	}
	data.top = Math.max(0, top);
	for (var key in data) {
		data[key] += 'px';
	}
	return data;
}

function showPicture(img_url) {
	var $picture = $('#picture');
	$body.addClass('show-picture');
	if ($picture.prop('src') != img_url) {
		$picture.prop('src', img_url);
	}
	$picture.hide().removeClass('run-animation').css({
		'width': '',
		'height': '',
		'margin-left': '',
		'transform': '',
		'left': '',
		'top': ''
	});
	var $overlay = $scrolling_elem = $('#picture-overlay');
	$overlay.removeClass('error').addClass('loading');
	$overlay.scrollTop(0);
	$picture.off().on('error', function(e) {
		$overlay.addClass('error').removeClass('loading');
		canceled = true;
	});
	var canceled = false;
	waitFor(function() {
		var height = $picture[0].naturalHeight;
		if (height && height > $body.height() * 1.5) {
			return true;
		}
		return $picture[0].complete || canceled;
	}, function() {
		$('#picture-copy').remove();
		var $picture_copy = $picture.clone();
		$picture_copy.prop('id', 'picture-copy');
		$picture.after($picture_copy);
		$overlay.removeClass('loading');
		if ($picture[0].naturalWidth > 400) {
			$picture.css('width', '400px');
		}
		var width = $picture.width();
		var height = $picture.height();
		$picture.css(computePosition({
			width: width / 1.5,
			height: height / 1.5
		}, true)).
		css({
			opacity: .05,
			display: 'block'
		}).
		show().
		addClass('run-animation').
		css(computePosition({
			width: width,
			height: height
		}, true)).
		css({
			opacity: 1
		});
		$('#picture-wrapper').css({
			animation: 'pictureSlideIn 225ms both',
			width: 400 + 'px',
			height: height
		});
	});
}

function hidePicture() {
	$scrolling_elem = $main;
	var $picture = $('#picture');
	var width = $picture.width();
	var height = $picture.height();
	var transform = $picture[0].style.transform ||
		$picture[0].style.webkitTransform;
	var rotate_deg = 0;
	if (transform && transform.indexOf('rotateZ') > -1) {
		rotate_deg = +transform.match(/rotateZ\((\d+)deg\)/)[1];
	}
	if (rotate_deg % 180) {
		var temp = width;
		width = height;
		height = temp;
	}
	var style = computePosition({
		width: width / 1.5,
		height: height / 1.5
	});
	style.left = (400 - ($picture.width() / 1.5)) / 2 + 'px';
	style.width = $picture.width() / 1.5 + 'px';
	style.height = $picture.height() / 1.5 + 'px';
	style.opacity = 0;
	style['margin-left'] = .05;
	$picture.css(style);
	$('#picture-wrapper').css({
		animation: 'pictureSlideOut 225ms both',
		width: '400px',
		height: height
	});
	setTimeout(function() {
		$('body').removeClass('show-picture');
		$picture.removeClass('run-animation');
	}, 225);
}

function rotatePicture() {
	var $picture = $('#picture');
	$picture.css('animation', '');
	var $picture_copy = $('#picture-copy');
	$picture_copy.attr('style', '');
	var transform = $picture[0].style.transform ||
		$picture[0].style.webkitTransform;
	var rotate_deg = 90;
	if (transform && transform.indexOf('rotateZ') > -1) {
		rotate_deg = +transform.match(/rotateZ\((\d+)deg\)/)[1];
		rotate_deg += 90;
	}
	var rotate_value = 'rotateZ(' + rotate_deg + 'deg)';
	var style = {
		'margin-left': 0
	};
	var width, height;
	waitFor(function() {
		return $picture_copy.width();
	}, function() {
		if (rotate_deg % 180 === 0) {
			if ($picture[0].naturalWidth > 400) {
				$picture_copy.css('width', '400px');
			}
		} else {
			if ($picture[0].naturalHeight > 400) {
				$picture_copy.css('height', '400px');
			}
			if ($picture[0].naturalWidth > 400) {
				style['margin-left'] = (400 - $picture_copy.width()) / 2 + 'px';
			}
		}
		width = $picture_copy.width();
		height = $picture_copy.height();
		$('#picture-wrapper').css(rotate_deg % 180 === 0 ? {
			width: width, height: height
		} : {
			width: height, height: width
		});
		$.extend(style, computePosition({
			width: width,
			height: height
		}));
		style.transform = rotate_value;
		$picture.css(style);
	});
}

var pre_count = {
	timeline: 0,
	mentions: 0,
	direct_messages: 0
};
function checkCount() {
	var count = PREFiX.count;
	var title_contents = [];
	var $home_tl = $('#navigation-bar .home-timeline .count');
	var $mentions = $('#navigation-bar .mentions .count');
	var $directmsgs = $('#navigation-bar .directmsgs .count');
	var $saved_searchs = $('#navigation-bar .saved-searches .count');
	if (count.mentions) {
		title_contents.push(count.mentions + ' @');
		$mentions.text(count.mentions).fadeIn(120);
		if (pre_count.mentions < count.mentions)
			drawAttention();
	} else {
		$mentions.text('').fadeOut(120);
	}
	pre_count.mentions = count.mentions;
	if (count.direct_messages) {
		title_contents.push(count.direct_messages + ' 私信');
		$directmsgs.text(count.direct_messages).fadeIn(120);
		if (pre_count.direct_messages < count.direct_messages)
			drawAttention();
	} else {
		$directmsgs.text('').fadeOut(120);
	}
	pre_count.direct_messages = count.direct_messages;
	var buffered = PREFiX.homeTimeline.buffered.filter(function(tweet) {
		return ! tweet.is_self;
	}).length;
	if (buffered) {
		title_contents.push(buffered + ' 新消息');
		$home_tl.text(Math.min(buffered, 99)).fadeIn(120);
	} else {
		$home_tl.text('').fadeOut(120);
	}
	var search_tweets_count = bg_win.getSavedSearchTweetsCount();
	if (search_tweets_count && PREFiX.settings.current.showSavedSearchCount) {
		title_contents.push(search_tweets_count + ' 关注话题消息');
		$saved_searchs.text(Math.min(search_tweets_count, 9)).fadeIn(120);
	} else {
		$saved_searchs.text('').fadeOut(120);
	}
	var title = 'PREFiX';
	if (title_contents.length) {
		title += ' (' + title_contents.join(' / ') + ')';
	}
	document.title = title;
}

function resetLoadingEffect() {
	$('#loading').hide();
	setTimeout(function() {
		$('#loading').show();
	}, 0);
}

function insertKeepScrollTop(insert) {
	var scroll_top = $main[0].scrollTop;
	var scroll_height = $main[0].scrollHeight;
	insert();
	setTimeout(function() {
		$main.scrollTop(scroll_top + $main[0].scrollHeight - scroll_height);
	}, 50);
}

function autoScroll(model, list) {
	list = fixTweetList(list);
	var first_item = list[0];
	var last_item = list[list.length - 1];
	var pre_target, target;
	setTimeout(function() {
		waitFor(function() {
			pre_target = target;
			var $item = model.$elem.find('li[data-id="' + last_item.id_str + '"]');
			if (! $item.length) return;
			var $breakpoint = $item.next('.breakpoint');
			if ($breakpoint.length) {
				$item = $breakpoint;
			}
			var offset = $item.offset().top + $item.height();
			var height = $body.height();
			var pos = $main.scrollTop();
			target = Math.max(pos - (height - offset), 0);
			return pre_target !== undefined && pre_target === target;
		}, function() {
			setCurrent(model, target > 0 ? last_item.id_str : first_item.id_str);
			if ($scrolling_elem === $main) {
				smoothScrollTo(target);
			}
		});
	}, 100);
}

function loadOldder() {
	var model = getCurrent();
	if (model.allLoaded) return;
	if (model === searches_model) {
		var oldest_tweet = searches_model.tweets[searches_model.tweets.length - 1];
		if (! oldest_tweet) return;
		var $selector = $('#topic-selector');
		var id = oldest_tweet.id_str;
		var k = $selector.val();
		if (k === '##MY_FAVORITES##') {
			PREFiX.getInstanceByRateLimit('getFavoritedTweets')({
				max_id: id,
				count: PREFiX.settings.current.tweetsPerPage
			}).setupAjax({
				lock: loadOldder,
				send: function() {
					loading = true;
				},
				oncomplete: function() {
					loading = false;
				}
			}).next(function(tweets) {
				if (tweets && tweets.length) {
					if (tweets[0].id_str === id) {
						tweets.splice(0, 1);
					}
				}
				var list = searches_model.tweets;
				list.push.apply(list, tweets);
				updateRelativeTime();
			});
		} else {
			if (k === null) {
				k = searches_model.keyword;
			}
			var id = oldest_tweet.id_str;
			PREFiX.getInstanceByRateLimit('searchTweets')({
				q: k,
				max_id: id,
				count: PREFiX.settings.current.tweetsPerPage
			}).setupAjax({
				lock: loadOldder,
				send: function() {
					loading = true;
				},
				oncomplete: function() {
					loading = false;
				}
			}).next(function(data) {
				var tweets = data.statuses;
				if (tweets && tweets.length) {
					if (tweets[0].id_str === id) {
						tweets.splice(0, 1);
					}
				}
				if (tweets && ! tweets.length) {
					//model.allLoaded = true;
				} else {
					push(searches_model.tweets, tweets);
				}
			});
		}
	} else if (model === usertl_model) {
		var oldest_tweet = usertl_model.tweets[usertl_model.tweets.length - 1];
		if (! oldest_tweet) return;
		PREFiX.user().getUserTimeline({
			id: PREFiX.userid,
			max_id: oldest_tweet.id_str,
		}).setupAjax({
			lock: loadOldder,
			send: function() {
				loading = true;
			},
			oncomplete: function() {
				loading = false;
			}
		}).next(function(tweets) {
			push(usertl_model.tweets, tweets);
		});
	} else if (model.tweets) {
		var oldest_tweet = model.tweets[model.tweets.length - 1];
		if (! oldest_tweet) return;
		var id = oldest_tweet.id_str;
		var get;
		if (model === tl_model) {
			get = PREFiX.getInstanceByRateLimit('getHomeTimeline');
		} else {
			get = PREFiX.getInstanceByRateLimit('getMentions');
		}
		get({
			max_id: id,
			count: PREFiX.settings.current.tweetsPerPage
		}).setupAjax({
			lock: loadOldder,
			send: function() {
				loading = true;
			},
			oncomplete: function() {
				loading = false;
			}
		}).error(function(e) {
			if (e.status && e.response) {
				showNotification(e.response.errors[0].message);
			} else {
				showNotification('加载时出现错误, 请检查网络连接.')
			}
			throw e;
		}).next(function(tweets) {
			if (tweets && tweets.length) {
				if (tweets[0].id_str === id) {
					tweets.splice(0, 1);
				}
			}
			if (tweets && ! tweets.length) {
				model.allLoaded = true;
				return;
			} else {
				push(model.tweets, tweets);
			}
		});
	} else {
		var oldest_message = model.messages[model.messages.length - 1];
		if (! oldest_message) return;
		var id = oldest_message.id_str;
		PREFiX.getInstanceByRateLimit('getDirectMessages')({
			max_id: id,
			count: PREFiX.settings.current.tweetsPerPage
		}).setupAjax({
			lock: loadOldder,
			send: function() {
				loading = true;
			},
			oncomplete: function() {
				loading = false;
			}
		}).error(function(e) {
			if (e.status && e.response) {
				showNotification(e.response.errors[0].message);
			} else {
				showNotification('加载时出现错误, 请检查网络连接.')
			}
			throw e;
		}).next(function(messages) {
			if (messages && messages.length) {
				if (messages[0].id_str === id) {
					messages.splice(0, 1);
				}
			}
			if (messages && ! messages.length) {
				model.allLoaded = true;
				return;
			}
			push(directmsgs_model.messages, messages);
		});
	}
}

function remove(e) {
	showNotification('正在删除..');
	var current_model = getCurrent();
	var current = current_model.current;
	var next;
	if (current) {
		var index;
		current_model.tweets.some(function(tweet, i) {
			if (tweet.id_str === current) {
				index = i;
				return true;
			}
		});
		if (index === current_model.tweets.length - 1) {
			index--;
		}
	}
	var self = this;
	var tweet_id = self.$vmodel.tweet.id_str;
	PREFiX.user().destroyTweet({
		id: tweet_id 
	}).setupAjax({
		lock: self
	}).error(function(e) {
		if (e.status !== 404 && e.response) {
			showNotification(e.response.errors[0].message);
			throw e;
		}
	}).next(function() {
		showNotification('删除成功!');
		var $item = $(self);
		$item.parents('.tweet').
		css('animation', 'remove .4s linear');
		$item.parents('li').
		slideUp(function() {
			self.$vmodel.$remove();
			deleteTweetFromAllLists(tweet_id);
			if (index >= 0) {
				setCurrent(current_model, current_model.tweets[index].id_str);
			}
		});
	});
}

function cancelReply() {
	var current_model = getCurrent();
	current_model.is_replying = false;
	current_model.tweets.some(function(tweet) {
		if (tweet.current_replied) {
			tweet.current_replied = false;
			return true;
		}
	});
}

function reply() {
	var tweet = this.$vmodel.tweet;
	composebar_model.type = 'reply';
	composebar_model.id = (tweet.retweeted_status || tweet).id_str;
	var at_users = { };
	at_users[tweet.user.screen_name] = true;
	if (tweet.retweeted_status) {
		at_users[tweet.retweeted_status.user.screen_name] = true;
	}
	var prefix = '@' + tweet.user.screen_name + ' ';
	if (tweet.retweeted_status) {
		prefix += '@' + tweet.retweeted_status.user.screen_name + ' ';
	}
	tweet.entities.user_mentions.forEach(function(user) {
		at_users[user.screen_name] = true;
	});
	var ated_users = [ 
		tweet.user.screen_name, 
		tweet.retweeted_status && tweet.retweeted_status.user.screen_name
	];
	var value = prefix + Object.keys(at_users).map(function(user) {
		if (user === PREFiX.account.screen_name) return '';
		return ated_users.indexOf(user) > -1 ? '' : ('@' + user + ' ');
	}).join('');
	composebar_model.text = value;
	$textarea.focus();
	$textarea[0].selectionStart = prefix.length;
	$textarea[0].selectionEnd = value.length;
	cancelReply();
	var current_model = getCurrent();
	current_model.is_replying = true;
	tweet.current_replied = true;
}

function retweet(vm) {
	return function() {
		var $vm = window[vm];
		var $vmodel = this.$vmodel;
		var tweet = $vmodel.tweet;
		if (tweet.is_self && ! tweet.retweeted) {
			return repost.apply(this, arguments);
		}
		if (tweet.user.protected && ! tweet.retweeted_status) {
			return repost.apply(this, arguments);
		}
		showNotification((tweet.retweeted ? '取消' : '正在') + '锐推..');
		if (tweet.retweeted) {
			PREFiX.user().destroyTweet({
				id: tweet.id_str
			}).next(function(tweet) {
				tweet = tweet.retweeted_status;
				$vm.tweets.splice($vmodel.$index, 1, tweet);
				setCurrent(getCurrent(), tweet.id_str);
				showNotification('取消锐推成功!');
			});
		} else {
			PREFiX.user().retweet({
				id: (tweet.retweeted_status || tweet).id_str
			}).next(function(tweet) {
				$vm.tweets.splice($vmodel.$index, 1, tweet);
				setCurrent(getCurrent(), tweet.id_str);
				showNotification('锐推成功!');
			});
		}
	}
}

function repost(e) {
	e.preventDefault();
	cancelReply();
	composebar_model.type = 'repost';
	composebar_model.id = '';
	var tweet = this.$vmodel.tweet;
	tweet = tweet.retweeted_status || tweet;
	var value = 'RT@' + tweet.user.screen_name + ' ' + tweet.text;
	composebar_model.text = value;
	composebar_model.id = tweet.in_reply_to_status_id_str || tweet.id_str;
	$textarea.focus();
	$textarea[0].selectionStart = $textarea[0].selectionEnd = 0;
}

function toggleFavourite(e) {
	var self = this;
	var tweet = self.$vmodel.tweet;
	tweet = tweet.retweeted_status || tweet;
	$(self).css('animation', '');
	showNotification(tweet.favorited ? '取消收藏..' : '正在收藏..')
	PREFiX.user()[tweet.favorited ? 'unfavorite' : 'favorite']({
		id: tweet.id_str
	}).setupAjax({
		lock: self
	}).next(function() {
		tweet.favorited = ! tweet.favorited;
		showNotification(tweet.favorited ? '收藏成功!' : '取消收藏成功!');
		$(self).css('animation', 'spring .5s linear');
	});
}

function showRelatedTweets(e) {
	$body.addClass('show-context-timeline');
	var $context_tl = $scrolling_elem = $('#context-timeline');
	$context_tl.removeClass('focusOutFromTop').addClass('focusInFromBottom loading');
	$context_tl.scrollTop(0);
	context_tl_model.tweets = [];
	var tweet = this.$model;
	tweet = tweet.retweeted_status || tweet;
	var tweets = [];
	(function get() {
		push(tweets, [ tweet ]);
		var id = tweet.in_reply_to_status_id_str;
		if (id) {
			showRelatedTweets.ajax = PREFiX.user().showTweet({ id: id }).next(function(s) {
				tweet = s;
				get();
			}).error(function() {
				$context_tl.removeClass('loading');
				unshift(context_tl_model.tweets, tweets, true);
			});
		} else {
			$context_tl.removeClass('loading');
			unshift(context_tl_model.tweets, tweets, true);
		}
	})();
}

function onNewTweetInserted() {
	this.forEach(bg_win.getOEmbed);
	this.forEach(function(tweet) {
		bg_win.cropAvatar(tweet, (tweet.user || tweet.sender).profile_image_url_https);
	});
}

var nav_model = avalon.define('navigation', function(vm) {
	vm.current = PREFiX.current;
	vm.showHomeTimeline = function(e) {
		if (loading) return;
		if (vm.current == 'tl_model' && $main.scrollTop())
			return goTop(e);
		last_model = PREFiX.current = vm.current = 'tl_model';
		tl_model.initialize();
	}
	vm.showMentions = function(e) {
		if (loading) return;
		if (vm.current == 'mentions_model' && $main.scrollTop())
			return goTop(e);
		last_model = PREFiX.current = vm.current = 'mentions_model';
		mentions_model.initialize();
	}
	vm.showdirectmsgs = function(e) {
		if (loading) return;
		if (vm.current == 'directmsgs_model' && $main.scrollTop())
			return goTop(e);
		last_model = PREFiX.current = vm.current = 'directmsgs_model';
		directmsgs_model.initialize();
	}
	vm.showSavedSearches = function(e) {
		if (loading) return;
		if (vm.current == 'searches_model' && $main.scrollTop())
			return goTop(e);
		last_model = PREFiX.current = vm.current = 'searches_model';
		searches_model.initialize();
	}
	vm.showUserTimeline = function(e) {
		if (loading) return;
		PREFiX.current = vm.current = 'usertl_model';
		usertl_model.initialize();
	}
	vm.$watch('current', function(new_value, old_value) {
		if (old_value == 'directmsgs_model') {
			composebar_model.type = '';
		}
		if (old_value == 'searches_model') {
			$('#topic-selector').hide();
		}
		if (new_value == 'searches_model') {
			$('#topic-selector').show();
		}
		getCurrent().allLoaded = false;
		if (old_value == 'usertl_model') {
			resetHeader();
		}
		$('#title').show();
		window[old_value] && window[old_value].unload();
		$('#navigation-bar li').removeClass('current');
		$('#stream > ul').removeClass('current');
		updateRelativeTime();
		resetLoadingEffect();
	});
});

var composebar_model = avalon.define('composebar-textarea', function(vm) {
	vm.text = vm.type = vm.id = vm.user = vm.screen_name = '';
	vm.submitting = false;
	vm.onfocus = function(e) {
		var placeholder = lyric = lyric || getLyric();
		if (vm.screen_name) {
			if (! vm.id) {
				placeholder = '发送私信给 @' + vm.screen_name;
			} else {
				placeholder = '回复 @' + vm.screen_name + ' 的私信';
			}
		}
		$textarea.prop('placeholder', placeholder);
		$('#compose-bar').toggleClass('uploading-not-supported', vm.type === 'send-dm');
	}
	vm.onblur = function(e) {
		$textarea.prop('placeholder', '');
		if (! vm.text.length) {
			vm.type = '';
			vm.id = '';
			vm.user = '';
			vm.screen_name = '';
		}
		$('#compose-bar').toggleClass('uploading-not-supported', vm.type === 'send-dm');
	}
	vm.ondblclick = function(e) {
		if (e.ctrlKey || e.metaKey) {
			if (! vm.text.trim() && ! PREFiX.image) {
				vm.text = $textarea.prop('placeholder');
			}
		} else if (PREFiX.settings.current.holdCtrlToSubmit) {
			return;
		}
		e.preventDefault();
		return vm.onkeydown({
			ctrlKey: true,
			keyCode: 13
		});
	}
	vm.onkeydown = function(e) {
		e.stopPropagation && e.stopPropagation();
		if (e.keyCode === 27 /* Esc */) {
			$textarea.blur();
			return;
		}
		var value = $textarea.val().trim();
		if ((! value && ! PREFiX.image) || vm.submitting) return;
		if (e.keyCode === 13 && (e.ctrlKey || e.metaKey)) {
			e.preventDefault && e.preventDefault();
			if (computeLength(value) > 140) return;
			vm.submitting = true;
			showNotification('正在提交..');
			var data = {
				status: vm.text.trim()
			};
			if (vm.type === 'reply' || vm.type === 'repost') {
				data.in_reply_to_status_id = vm.id;
			}
			if (vm.type === 'send-dm') {
				PREFiX.user().createDirectMessage({
					user_id: vm.user,
					text: vm.text.trim()
				}).setupAjax({
					lock: vm
				}).next(function() {
					showNotification('发表成功!');
					vm.text = '';
					$textarea.blur();
				}).error(function(e) {
					if (e.status && e.response) {
						showNotification(e.response.errors[0].message);
					} else {
						showNotification('发送失败, 请检查网络连接.')
					}
				}).next(function() {
					vm.submitting = false;
				});
			} else {
				var $compose_bar = $('#compose-bar');
				var full_length = $compose_bar.width();
				data.status = vm.text;
				data['media[]'] = PREFiX.image;
				PREFiX.user()[ PREFiX.image ? 'uploadPhoto' : 'postTweet' ](data).
				setupAjax({
					lock: vm,
					timeout: PREFiX.image ? 180000 : 30000,
					onstart: function(e) {
						if (PREFiX.image) {
							$textarea.css('background-size', '48px 1px');
							$compose_bar.addClass('uploading');
						}
					},
					onprogress: function(e) {
						if (! PREFiX.image || ! e.lengthComputable) return;
						var percent = e.loaded / e.total;
						var green_length = Math.round(percent * full_length);
						$textarea.css('background-size', Math.max(48, green_length) + 'px 1px');
					},
					oncomplete: function(e) {
						$compose_bar.removeClass('uploading');
						$textarea.css('background-size', '');
					}
				}).next(function(tweet) {
					showNotification('发表成功!');
					vm.text = '';
					setImage(null);
					$textarea.blur();
					var remaining_hits = bg_win.rate_limit.default.getHomeTimeline;
					if (bg_win.rate_limit.sub.getHomeTimeline) {
						remaining_hits += bg_win.rate_limit.sub.getHomeTimeline;
					}
					if (remaining_hits >= 5) {
						PREFiX.updateHomeTimeline(7, tweet.id_str);
					}
				}).error(function(e) {
					if (e.status && e.response) {
						showNotification(e.response.errors[0].message);
					} else {
						showNotification('发送失败, 请检查网络连接.')
					}
				}).next(function() {
					vm.submitting = false;
				});
			}
		}
	}
	vm.$watch('text', function(value) {
		if (! value && nav_model.current != 'directmsgs_model') {
			vm.type = '';
			vm.id = '';
			vm.user = '';
			vm.screen_name = '';
			cancelReply();
		}
		$textarea.toggleClass('filled', !! value);
		count();
		PREFiX.compose.text = value;
	});
	vm.$watch('type', function(value) {
		PREFiX.compose.type = value;
	});
	vm.$watch('id', function(value) {
		PREFiX.compose.id = value;
	});
	vm.$watch('user', function(value) {
		PREFiX.compose.user = value;
	});
	vm.$watch('screen_name', function(value) {
		PREFiX.compose.screen_name = value;
	});
});

var tl_model = avalon.define('home-timeline', function(vm) {
	vm.current = PREFiX.homeTimeline.current;

	vm.remove = remove;

	vm.reply = reply;

	vm.repost = repost;

	vm.retweet = retweet('tl_model');

	vm.toggleFavourite = toggleFavourite;

	vm.showRelatedTweets = showRelatedTweets;
	
	vm.tweets = [];

	vm.scrollTop = 0;

	vm.is_replying = PREFiX.homeTimeline.is_replying;

	vm.screenNameFirst = PREFiX.settings.current.screenNameFirst;
});
tl_model.$watch('current', function(value) {
	PREFiX.homeTimeline.current = value;
});
tl_model.$watch('is_replying', function(value) {
	PREFiX.homeTimeline.is_replying = value;
});
tl_model.$watch('scrollTop', function(value) {
	PREFiX.homeTimeline.scrollTop = value;
});
tl_model.tweets.$watch('length', function() {
	PREFiX.homeTimeline.tweets = tl_model.$model.tweets.map(function(t) {
		return t.$model || t;
	});
});
tl_model.tweets.$watch('length', onNewTweetInserted);
tl_model.initialize = function() {
	$('#navigation-bar .home-timeline').addClass('current');
	$('#title h2').text('Timeline');
	$('#home-timeline').addClass('current');

	var tl = PREFiX.homeTimeline;
	waitFor(function() {
		return tl.tweets.length;
	}, function() {
		tl_model.tweets = tl.tweets;
		markBreakpoint();
		setTimeout(function() {
			$main.scrollTop(PREFiX.homeTimeline.scrollTop);
			initKeyboardControl();
		}, 50);
		updateRelativeTime();
	});

	this.interval = setInterval(function update() {
		if (! tl.buffered.length) {
			pre_count.timeline = 0;
			return;
		}
		if (tl.buffered.length !== pre_count.timeline) {
			if (PREFiX.settings.current.drawAttention)
				drawAttention();
			pre_count.timeline = tl.buffered.length;
		}
		if (! PREFiX.is_popup_focused || $main[0].scrollTop > $body.height / 2)
			return;
		var buffered = tl.buffered;
		tl.buffered = [];
		if (! tl.tweets.length) {
			unshift(tl_model.tweets, buffered);
		} else {
			setTimeout(function() {
				var scroll_top = $main.scrollTop();
				insertKeepScrollTop(function() {
					if (buffered.length >= 50) {
						var now = Date.now();
						var is_breakpoint = breakpoints.some(function(time) {
							return Math.abs(time - now) < 500;
						});
						if (is_breakpoint) {
							buffered = fixTweetList(buffered);
							var oldest_tweet = buffered[buffered.length - 1];
							oldest_tweet.is_breakpoint = true;
							oldest_tweet.loaded_at = 'Loaded @ ' + getShortTime(now) + '.';
						}
					}
					unshift(tl_model.tweets, buffered);
					if (scroll_top <= 30) {
						autoScroll(tl_model, buffered);
					}
					PREFiX.updateTitle();
				});
			}, 50);
		}

		PREFiX.updateTitle();
	}, 16);
}
tl_model.unload = function() {
	clearInterval(this.interval);
}

var mentions_model = avalon.define('mentions', function(vm) {
	vm.current = PREFiX.mentions.current;

	vm.remove = remove;

	vm.reply = reply;

	vm.repost = repost;

	vm.retweet = retweet('mentions_model');

	vm.toggleFavourite = toggleFavourite;
	
	vm.showRelatedTweets = showRelatedTweets;

	vm.tweets = [];

	vm.scrollTop = 0;

	vm.is_replying = PREFiX.mentions.is_replying;

	vm.screenNameFirst = PREFiX.settings.current.screenNameFirst;
});
mentions_model.$watch('current', function(value) {
	PREFiX.mentions.current = value;
});
mentions_model.$watch('is_replying', function(value) {
	PREFiX.mentions.is_replying = value;
});
mentions_model.$watch('scrollTop', function(value) {
	PREFiX.mentions.scrollTop = value;
});
mentions_model.tweets.$watch('length', function() {
	PREFiX.mentions.tweets = mentions_model.$model.tweets.map(function(t) {
		return t.$model || t;
	});
});
mentions_model.tweets.$watch('length', onNewTweetInserted);
mentions_model.initialize = function() {
	$('#navigation-bar .mentions').addClass('current');
	$('#title h2').text('Mentions');
	$('#mentions').addClass('current');

	var mentions = PREFiX.mentions;
	waitFor(function() {
		return mentions.tweets.length;
	}, function() {
		mentions_model.tweets = mentions.tweets;
		setTimeout(function() {
			$main.scrollTop(PREFiX.mentions.scrollTop);
			initKeyboardControl();
		}, 50);
		updateRelativeTime();
	});

	this.interval = setInterval(function update() {
		if (! mentions.buffered.length) {
			pre_count.mentions = 0;
			return;
		}
		if (mentions.buffered.length !== pre_count.mentions) {
			if (PREFiX.settings.current.drawAttention)
				drawAttention();
			pre_count.mentions = mentions.buffered.length;
		}
		if (! PREFiX.is_popup_focused || $main[0].scrollTop)
			return;

		var buffered = mentions.buffered;
		mentions.buffered = [];

		PREFiX.count.mentions = 0;

		if (! mentions.tweets.length) {
			unshift(mentions_model.tweets, buffered);
		} else {
			setTimeout(function() {
				var scroll_top = $main.scrollTop();
				insertKeepScrollTop(function() {
					unshift(mentions_model.tweets, buffered);
					if (scroll_top <= 30) {
						autoScroll(mentions_model, buffered);
					}
					PREFiX.updateTitle();
				});
			}, 50);
		}

		PREFiX.updateTitle();
	}, 16);
}
mentions_model.unload = function() {
	clearInterval(this.interval);
}

var directmsgs_model = avalon.define('directmsgs', function(vm) {
	vm.current = PREFiX.directmsgs.current;

	vm.remove = function() {
		showNotification('正在删除..')
		var current_model = directmsgs_model;
		var current = current_model.current;
		var next;
		if (current) {
			var index;
			current_model.messages.some(function(message, i) {
				if (message.id_str === current) {
					index = i;
					return true;
				}
			});
			if (index === current_model.messages.length - 1) {
				index--;
			}
		}
		var self = this;
		var message_id = self.$vmodel.message.id_str;
		PREFiX.user().destroyDirectMessage({
			id: message_id 
		}).setupAjax({
			lock: self
		}).error(function(e) {
			if (e.status !== 404 && e.response) {
				showNotification(e.response.errors[0].message);
				throw e;
			}
		}).next(function() {
			showNotification('删除成功!');
			var $item = $(self);
			$item.parents('.tweet').
			css('animation', 'remove .4s linear');
			$item.parents('li').
			slideUp(function() {
				self.$vmodel.$remove();
				if (index >= 0) {
					setCurrent(current_model, current_model.messages[index].id_str);
				}
			});
		});
	}

	vm.reply = function() {
		var message = this.$vmodel.message;
		composebar_model.text = '';
		composebar_model.type = 'send-dm';
		composebar_model.id = message.id_str;
		composebar_model.user = message.sender.id;
		composebar_model.screen_name = message.sender.name;
		$textarea.focus();
	}

	vm.messages = [];

	vm.scrollTop = 0;

	vm.screenNameFirst = PREFiX.settings.current.screenNameFirst;
});
directmsgs_model.$watch('current', function(value) {
	PREFiX.directmsgs.current = value;
});
directmsgs_model.$watch('scrollTop', function(value) {
	PREFiX.directmsgs.scrollTop = value;
});
directmsgs_model.messages.$watch('length', function() {
	PREFiX.directmsgs.messages = directmsgs_model.$model.messages.map(function(m) {
		return m.$model || m;
	});
});
directmsgs_model.messages.$watch('length', onNewTweetInserted);
directmsgs_model.initialize = function() {
	$('#navigation-bar .directmsgs').addClass('current');
	$('#title h2').text('Direct Messages');
	$('#directmsgs').addClass('current');

	var directmsgs = PREFiX.directmsgs;
	waitFor(function() {
		return directmsgs.messages.length;
	}, function() {
		directmsgs_model.messages = directmsgs.messages;
		setTimeout(function() {
			$main.scrollTop(PREFiX.directmsgs.scrollTop);
			initKeyboardControl();
		}, 50);
		updateRelativeTime();
	});

	this.interval = setInterval(function update() {
		if (! directmsgs.buffered.length) {
			pre_count.directmsgs = 0;
			return;
		}
		if (directmsgs.buffered.length !== pre_count.directmsgs) {
			if (PREFiX.settings.current.drawAttention)
				drawAttention();
			pre_count.directmsgs = directmsgs.buffered.length;
		}
		if (! PREFiX.is_popup_focused || $main[0].scrollTop)
			return;

		var buffered = directmsgs.buffered;
		directmsgs.buffered = [];

		PREFiX.count.direct_messages = 0;

		if (! directmsgs.messages.length) {
			unshift(directmsgs_model.messages, buffered);
		} else {
			setTimeout(function() {
				var scroll_top = $main.scrollTop();
				insertKeepScrollTop(function() {
					unshift(directmsgs_model.messages, buffered);
					if (scroll_top <= 30) {
						autoScroll(directmsgs_model, buffered);
					}
					PREFiX.updateTitle();
				});
			}, 50);
		}

		PREFiX.updateTitle();
	}, 16);
}
directmsgs_model.unload = function() {
	clearInterval(this.interval);
}

var searches_model = avalon.define('saved-searches', function(vm) {
	vm.remove = remove;

	vm.reply = reply;

	vm.repost = repost;

	vm.retweet = retweet('searches_model');

	vm.toggleFavourite = toggleFavourite;

	vm.showRelatedTweets = showRelatedTweets;

	vm.keyword = PREFiX.keyword;

	vm.is_replying = false;

	vm.tweets = [];

	vm.screenNameFirst = PREFiX.settings.current.screenNameFirst;
});
searches_model.$watch('keyword', function() {
	PREFiX.keyword = searches_model.keyword;
});
searches_model.tweets.$watch('length', onNewTweetInserted);
searches_model.initialize = function() {
	$('#navigation-bar .saved-searches').addClass('current');
	$('#title h2').text('Discover');
	$('#saved-searches').addClass('current');

	$main.scrollTop(0);

	function showFavorites() {
		$('#topic-selector').prop('disabled', true);
		searches_model.tweets = [];
		searches_model.current = null;
		PREFiX.getInstanceByRateLimit('getFavoritedTweets')({
			count: PREFiX.settings.current.tweetsPerPage
		}).next(function(tweets) {
			searches_model.tweets = tweets;
			initKeyboardControl();
			updateRelativeTime();
		}).hold(function() {
			$('#topic-selector').prop('disabled', false);
		});
	}

	function search() {
		var keyword = searches_model.keyword;
		searches_model.tweets = [];
		searches_model.current = null;
		var tweets;
		var is_saved = bg_win.saved_searches_items.some(function get(item) {
			if (item.keyword !== keyword) return;
			tweets = JSON.parse(JSON.stringify(item.tweets));
			if (! tweets || ! tweets.length) {
				setTimeout(function() {
					get(item);
				}, 100);
				return;
			}
			lscache.set('saved-search-' + keyword + '-id', tweets[0].id_str);
			item.unread_count = 0;
			item.check();
			return true;
 		});
 		if (is_saved) {
			unshift(searches_model.tweets, tweets);
			initKeyboardControl();
			PREFiX.updateTitle();
		} else {
			PREFiX.getInstanceByRateLimit('searchTweets')({
				q: keyword,
				count: PREFiX.settings.current.tweetsPerPage
			}).setupAjax({
				lock: search
			}).next(function(data) {
				tweets = data.statuses;
				unshift(searches_model.tweets, tweets);
				initKeyboardControl();
			});
		}
	}

	function refreshCount() {
		bg_win.saved_searches_items.some(function(item) {
			$selector.find('option').each(function() {
				var $item = $(this);
				if ($item.val() === item.keyword) {
					var text = item.keyword;
					if (item.unread_count) {
						text += ' (' + item.unread_count + ')';
					}
					if (text !== $item.text()) {
						$item.text(text);
					}
				}
			});
		});
	}

	if (! $('#topic-selector').length) {
		var $selector = $('<select />');
		$selector.prop('id', 'topic-selector');
		$selector.prop('tabIndex', 2);

		var $fav = $('<option />');
		$fav.text('我的收藏');
		$fav.prop('value', '##MY_FAVORITES##');
		$selector.append($fav);

		bg_win.saved_searches_items.some(function(item) {
			var $item = $('<option />');
			$item.val(item.keyword);
			$item.text(item.keyword);
			$selector.append($item);
		});

		var $search = $('<option />');
		$search.text('搜索');
		$search.prop('value', '##SEARCH##');
		$search.prop('disabled', true);
		$selector.append($search);

		$selector.val('##MY_TIMELINE##');
		$selector.appendTo('#title');

		$selector.on('change', function(e) {
			if (this.value === '##MY_FAVORITES##') {
				searches_model.keyword = '';
				showFavorites();
			} else if (this.value === '##SEARCH##') {
				searches_model.keyword = searches_model.search_keyword;
				delete searches_model.search_keyword;
				search();
			} else {
				searches_model.keyword = this.value;
				search();
			}
		});

		refreshCount();
	}

	var last = bg_win.saved_searches_items.some(function(item) {
		if (item.keyword === searches_model.keyword) {
			return !! item.unread_count;
		}
	});

	var $selector = $('#topic-selector');
	if (searches_model.search_keyword) {
		$selector.val('##SEARCH##');
	} else if (last) {
		$selector.val(searches_model.keyword);
	} else if (! last && bg_win.getSavedSearchTweetsCount()) {
		bg_win.saved_searches_items.some(function(item) {
			if (item.unread_count) {
				$selector.val(item.keyword);
				return true;
			}
		});
	} else if (searches_model.keyword) {
		var keyword = searches_model.keyword;
		var is_saved = [].slice.call($selector.find('option')).
			some(function(option) {
				return option.value === keyword;
			});
		$selector.val(is_saved ? keyword : '##MY_TIMELINE##');
	} else {
		$selector.val('##MY_TIMELINE##');
	}
	$selector.trigger('change');

	this.interval = setInterval(refreshCount, 100);
}
searches_model.unload = function() {
	clearInterval(this.interval);
}

var usertl_model = avalon.define('user-timeline', function(vm) {
	vm.remove = remove;

	vm.reply = reply;

	vm.repost = repost;

	vm.retweet = retweet('usertl_model');

	vm.toggleFavourite = toggleFavourite;

	vm.showRelatedTweets = showRelatedTweets;

	vm.tweets = [];

	vm.is_replying = false;

	vm.screenNameFirst = PREFiX.settings.current.screenNameFirst;
});
usertl_model.initialize = function() {
	$('#title').hide();
	$('#user-timeline').addClass('current');
	$('h1, #back').attr('style', '');
	$body.addClass('show-back-button');

	PREFiX.user().getUser({
		user_id: PREFiX.userid
	}).next(function(user) {
		user.error = '';
		var following = user.following;
		var $relationship = $('#relationship');
		if (user.protected && ! user.following) {
			user.error = '该用户没有公开 TA 的消息. ';
		} else if (! user.status) {
			user.error = '该用户还没有发表消息. '
		}
		if (user.status) {
			PREFiX.user().getUserTimeline({
				user_id: PREFiX.userid
			}).next(function(tweets) {
				unshift(usertl_model.tweets, tweets);
				setTimeout(initKeyboardControl);
				if (following) {
					PREFiX.user().lookupFriendship({
						user_id: PREFiX.userid
					}).
					next(function(result) {
						if (result[0].connections.indexOf('followed_by') > -1) {
							$('#relationship').text('互相关注');
						} else {
							$relationship.prop('title', '取消关注');
						}
					});
				}
			});
		} else {
			var tweets = [ { id: 0, id_str: '', user: user } ];
			usertl_model.tweets = tweets;
			$relationship.prop('title', following ? '取消关注' : '');
		}
		if (user.error) {
			$('#loading').hide();
		}
	})

	usertl_model.tweets = [];
	$main.scrollTop(0);
	usertl_model.current = null;
	usertl_model.is_replying = false;
}
usertl_model.unload = function() { }

var context_tl_model = avalon.define('context-timeline', function(vm) {
	vm.tweets = [];

	vm.screenNameFirst = PREFiX.settings.current.screenNameFirst;
});
context_tl_model.tweets.$watch('length', function(length) {
	if (! length) return;
	var $context_tl = $('#context-timeline');
	$context_tl.find('li').each(function(i) {
		setTimeout(function() {
			$(this).show();
		}.bind(this), i * 100);
	});
});
context_tl_model.tweets.$watch('length', onNewTweetInserted);

$(function() {
	initMainUI();
	setTimeout(function() {
		$textarea.focus();
		if (! PREFiX.compose.text) {
			$textarea.blur();
		} else if (PREFiX.compose.type === 'repost') {
			$textarea[0].selectionStart = $textarea[0].selectionEnd = 0;
		}
		getCurrent().initialize();
		initKeyboardControlEvents();
		setTimeout(showUsageTip, 100);
		var $tip = $('#uploading-photo-tip');
		var shown = lscache.get('uploading_photo_tip');
		if (! shown && lscache.get('hide-following-tip')) {
			$tip.show();
			$('#hide-uploading-photo-tip').click(function(e) {
				$tip.css({
					'animation-name': 'wobbleOut',
					'animation-duration': 400
				}).delay(400).hide(0, function() {
					$(this).remove();
					lscache.set('uploading_photo_tip', true);
				});
			});
		} else {
			$tip.remove();
	 	}
	}, 100);
});

onunload = function() {
	PREFiX.popupActive = false;
	if ($main[0].scrollTop < 30)
		cutStream();
	if (is_panel_mode) {
		var pos = {
			x: screenX,
			y: screenY
		};
		lscache.set('popup_pos', pos);
	}
	PREFiX.panelMode = false;
	PREFiX.is_popup_focused = false;
}

if (location.search == '?new_window=true') {
	is_panel_mode = true;
	$('html').addClass('panel-mode');
	initFixSize(400, 600);
	$(applyViewHeight);
	PREFiX.panelMode = true;
} else {
	PREFiX.panelMode = false;
}

chrome.runtime.sendMessage({ });

bg_win.hideAllNotifications();