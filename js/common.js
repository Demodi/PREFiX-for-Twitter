var default_consumer = {
	consumer_key: 'yBSjn0E6IH5ccRcFqu5Bg',
	consumer_secret: 's6mmPCRVKFFz6lp6c2npBZ3tcUDPFolZX2A2Kr4kvs'
};
Ripple.setupConsumer(default_consumer);

var sub_consumer = {
	consumer_key: 'Lp3DKTAhhUwaBvEOIrAqA',
	consumer_secret: 'LuVB86K07thONyg8ypI4nrJm85zInHBTAPaNV93BY'
};

function getViewHeight() {
	return lscache.get('popup_view_height') || 600;
}

function createPopup() {
	var width = 400;
	var height = getViewHeight();
	var url = '/popup.html?new_window=true';
	var size = getDefaultWindowSize(width, height);
	var options = {
		url: url,
		focused: true,
		type: 'panel',
		width: Math.round(size.width),
		height: Math.round(size.height),
		left: Math.round((screen.width - size.width) / 2),
		top: Math.round((screen.height - size.height) / 2)
	};
	chrome.windows.create(options);
}

var waitFor = (function() {
	var waiting_list = [];

	var interval = 0;
	var lock = false;
	function setWaiting() {
		if (interval) return;
		interval = setInterval(function() {
			if (lock) return;
			lock = true;

			var not_avail = 0;
			for (var i = 0; i < waiting_list.length; ++i) {
				var item = waiting_list[i];
				if (item) {
					if (item.checker()) {
						item.worker();
						waiting_list[i] = null;
					} else {
						++not_avail;
					}
				}
			}

			if (! not_avail) {
				interval = 0 * clearInterval(interval);
			}

			lock = false;
		}, 40);
	}

	return function(checker, worker) {
		if (checker()) return worker();
		waiting_list.push({ checker: checker, worker: worker });
		setWaiting();
	};
})();

var getRelativeTime = Ripple.helpers.generateTimeFormater(function(table) {
	return [
		[
			15 * table.s,
			function() {
				return 'Just now';
			}
		], [
			table.m,
			function(convertor) {
				return convertor.s() + ' secs ago';
			}
		], [
			table.h,
			function(convertor) {
				var m = convertor.m();
				return m + ' min' + (m === '1' ? '' : 's') + ' ago';
			}
		], [
			table.d,
			function(convertor) {
				var h = convertor.h();
				return h + ' hr' + (h === '1' ? '' : 's') + ' ago';
			}
		], function(c) {
			return c._MS(3) +　' ' + c._d(true) + ' ' + c._h(2) + ':' + c._m(2);
		}
	];
});

var getYMD = Ripple.helpers.generateTimeFormater(function(table) {
	return [
		function(c) {
			return c._yr() + '-' + c._ms(2) + 　 '-' + c._d(2);
		}
	];
});

var getShortTime = Ripple.helpers.generateTimeFormater(function(table) {
	return [ function(c) {
		return c._MS(3) +　' ' + c._d(true) + ' ' + c._h(2) + ':' + c._m(2);
	} ];
});

var getFullTime = Ripple.helpers.generateTimeFormater(function(table) {
	return [
		function(c) {
			return c._yr() + '-' + c._ms(2) + 　 '-' + c._d(2) +
			' ' + c._h(2) + ':' + c._m(2) + ':' + c._s(2);
		}
	];
});

var re = new RegExp;
re.compile('[「\u4E00-\u9FA5\uf900-\ufa2d」]', 'g');
function fixTweetList(tweets) {
	var $text = $('<div />');
	tweets.forEach(function(tweet) {
		var created_at = (tweet.retweeted_status || tweet).created_at;
		tweet.relativeTime = getRelativeTime(created_at);
	});
	return tweets.sort(function(tweet_a, tweet_b) {
		return tweet_b.id - tweet_a.id;
	});
}

function filter(list, tweets) {
	if (! tweets.length) return tweets;
	var ids = { };
	list.forEach(function(s) {
		ids[s.id_str] = true;
	});
	return tweets.filter(function(tweet) {
		return ids[tweet.id_str] !== true;
	});
}

function push(list, tweets, reverse) {
	tweets = filter(list, tweets);
	if (! tweets.length) return;
	tweets = fixTweetList(tweets);
	if (reverse) tweets = tweets.reverse();
	list.push.apply(list, tweets);
}

function unshift(list, tweets, reverse) {
	tweets = filter(list, tweets);
	if (! tweets.length) return;
	tweets = fixTweetList(tweets);
	if (reverse) tweets = tweets.reverse();
	list.unshift.apply(list, tweets);
}

function isImage(type) {
	switch (type) {
	case 'image/jpeg':
	case 'image/png':
	case 'image/gif':
	case 'image/bmp':
	case 'image/jpg':
		return true;
	default:
		return false;
	}
}

function computeSize(size) {
	var units = ['', 'K', 'M', 'G', 'T'];
	while (size / 1024 >= .75) {
		size = size / 1024;
		units.shift();
	}
	size = Math.round(size * 10) / 10 + units[0] + 'B';
	return size;
}

function fixTransparentPNG(file) {
	var d = new Deferred;
	var img = new Image;
	var fr = new FileReader;
	fr.onload = function(e) {
		img.src = fr.result;
		Ripple.helpers.image2canvas(img).
		next(function(canvas) {
			var ctx = canvas.getContext('2d');
			var image_data = ctx.getImageData(0, 0, canvas.width, canvas.height);
			var pixel_array = image_data.data;
			var m, a, s;
			for (var i = 0, len = pixel_array.length; i < len; i += 4) {
				a = pixel_array[i+3];
				if (a === 255) continue;
				s = 255 - a;
				a /= 255;
				m = 3;
				while (m--) {
					pixel_array[i+m] = pixel_array[i+m] * a + s;
				}
				pixel_array[i+3] = 255;
			}
			ctx.putImageData(image_data, 0, 0);
			canvas.toBlob(function(blob) {
				blob.name = file.name;
				d.call(blob);
			});
		});
	}
	fr.readAsDataURL(file);
	return d;
}

function getDefaultWindowSize(width, height) {
	var PREFiX = chrome.extension.getBackgroundPage().PREFiX;
	var ratio = +PREFiX.settings.current.zoomRatio;
	width = Math.round(width * ratio);
	height = Math.round(height * ratio);
	var delta_x = lscache.get('delta_x') || outerWidth - innerWidth;
	var delta_y = lscache.get('delta_y') || outerHeight - innerHeight;
	return {
		width: width + delta_x,
		height: height + delta_y
	};
 }

var fixing_size = false;
function initFixSize(width, height) {
	var PREFiX = chrome.extension.getBackgroundPage().PREFiX;
	var ratio = +PREFiX.settings.current.zoomRatio;
	var target_width = Math.round(width * ratio);
	var target_height = Math.round(height * ratio);
	onresize = _.throttle(function() {
		if (fixing_size) return;
		fixing_size = true;
		var size = getDefaultWindowSize(width, height);
		size.height = Math.max(size.height, outerHeight);
		resizeTo(size.width, size.height);
		setTimeout(function() {
			var _height = Math.max(innerHeight, target_height);
			resizeBy(target_width - innerWidth, _height - innerHeight);
			setTimeout(function() {
				lscache.set('delta_x', outerWidth - innerWidth);
				lscache.set('delta_y', outerHeight - innerHeight);
				setViewHeight(innerHeight / ratio);
				fixing_size = false;
			}, 48);
		}, 36);
	}, 24);
	setInterval(function() {
		if (innerWidth !== target_width || innerHeight < target_height)
			onresize();
	}, 250);
}