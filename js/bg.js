var ce = chrome.extension;
var ct = chrome.tabs;
var root_url = ce.getURL('');
var popup_url = ce.getURL('popup.html');
var panel_url = ce.getURL('/popup.html?new_window=true');

var short_url_re = /https?:\/\/(?:bit\.ly|goo\.gl|v\.gd|is\.gd|tinyurl\.com|to\.ly|yep\.it|j\.mp)\//;

var rate_limit = {
	default: { },
	sub: { }
}

var $temp = $('<div />');

var current_id = '';

chrome.runtime.onMessage.addListener(function(request, sender) {
	if (request.act === 'draw_attention') {
		if (! sender || ! sender.tab || ! sender.tab.windowId) return;
		chrome.windows.update(sender.tab.windowId, {
			drawAttention: true
		});
	} else if (request.act === 'stop_drawing_attention') {
		if (! sender || ! sender.tab || ! sender.tab.windowId) return;
		chrome.windows.update(sender.tab.windowId, {
			drawAttention: false
		});
	} else if (request.act === 'send_pincode') {
		getSubAccessToken(request.code);
	} else {
		chrome.tabs.query({
			url: panel_url
		}, function(tabs) {
			tabs.forEach(function(tab) {
				if (! sender.tab) {
					chrome.tabs.remove(tab.id);
				}
			});
		});
	}
});

function getRateLimit() {
	function process(instance, detail) {
		var resources = detail.resources;
		instance.getHomeTimeline = resources.statuses['/statuses/home_timeline'].remaining;
		instance.getMentions = resources.statuses['/statuses/mentions_timeline'].remaining;
		instance.getUserTimeline = resources.statuses['/statuses/user_timeline'].remaining;
		instance.getDirectMessages = resources.direct_messages['/direct_messages'].remaining;
		instance.getFavoritedTweets = resources.favorites['/favorites/list'].remaining;
		instance.searchTweets = resources.search['/search/tweets'].remaining;
	}
	var default_instance = getDefaultInstance();
	if (default_instance) {
		default_instance.getRateLimitStatus().
		next(function(detail) {
			process(rate_limit.default, detail);
		});
	} else {
		rate_limit.default = { };
	}
	var sub_instance = getSubInstance();
	if (sub_instance) {
		sub_instance.getRateLimitStatus().
		next(function(detail) {
			process(rate_limit.sub, detail);
		});
	} else {
		rate_limit.sub = { };
	}
}

function getDefaultInstance() {
	if (! PREFiX.accessToken) return;
	return Ripple(PREFiX.accessToken);
}

function getSubInstance() {
	var sub_access_token = lscache.get('sub_access_token');
	if (sub_access_token) {
		return Ripple(sub_access_token, {
			consumer: sub_consumer
		});
	}
}

function getInstanceByRateLimit(method) {
	var default_instance_remaining = rate_limit.default[method] || 0;
	var sub_instance_remaining = rate_limit.sub[method] || 0;
	var instance, func;
	var type = 'default';
	if (sub_instance_remaining > 0) {
		if (default_instance_remaining < sub_instance_remaining) {
			instance = getSubInstance();
			func = instance[method].bind(instance);
			type = 'sub';
		}
	}
	if (! func) {
		instance = getDefaultInstance();
		func = instance[method].bind(instance);
	}
	return function() {
		return func.apply(instance, arguments).next(function(data) {
			--rate_limit[type][method];
			return data;
		});
	}
}

function getPanelWindow(callback) {
	var views = chrome.extension.getViews();
	views.some(function(view) {
		if (view.location.href == panel_url) {
			callback(view);
			return true;
		}
	});
}

function getPopup(callback) {
	var views = chrome.extension.getViews();
	views.some(function(view) {
		if (view.location.href.indexOf(popup_url) === 0) {
			callback(view);
			return true;
		}
	});
}

function initUrlExpand() {
	var short_url_services = lscache.get('short_url_services');
	if (short_url_services) {
		// 识别更多短链接
		short_url_services['[a-z0-9]{1,5}\.[a-z]{2,3}'] = true;
		var re = '^https?:\\/\\/';
		re += '(?:' + Object.keys(short_url_services).join('|') + ')';
		re += '\\/\\S+';
		re = re.replace(/\./g, '\\.');
		PREFiX.shortUrlRe = new RegExp(re);
		return;
	}
	Ripple.ajax.get('http://api.longurl.org/v2/services', {
		params: {
			format: 'json'
		},
		success: function(data) {
			lscache.set('short_url_services', data);
			initUrlExpand();
		},
		error: function(e) {
			setTimeout(initUrlExpand, 60000);
		}
	});
}

var cachedShortUrls = { };
function expandUrl(url) {
	var d = new Deferred;
	if (cachedShortUrls[url]) {
		setTimeout(function() {
			d.call(cachedShortUrls[url]);
		});
	} else {
		Ripple.ajax.get('http://api.longurl.org/v2/expand', {
			params: {
				url: url,
				format: 'json'
			}
		}).next(function(data) {
			var long_url = data['long-url'];
			cachedShortUrls[url] = long_url;
			d.call(long_url);
		});
	}
	return d;
}

function user() {
	if (! PREFiX.accessToken) return;
	var account_instances = [];
	account_instances.push(getDefaultInstance());
	var sub_instance = getSubInstance();
	if (sub_instance) {
		account_instances.push(sub_instance);
	}
	var total = account_instances.length;
	return account_instances[Math.round(Math.random() * (total - 1))];
}

function batchProcess(callback) {
	var views = ce.getViews();
	views.forEach(callback);
}

function markTweetAsFavourited(tweet_id) {
	var lists = [
		PREFiX.homeTimeline.buffered,
		PREFiX.homeTimeline.tweets,
		PREFiX.mentions.buffered,
		PREFiX.mentions.tweets
	];
	lists.forEach(function(list) {
		list.some(function(tweet) {
			if (tweet.id_str === tweet_id) {
				tweet.favorited = true;
				return true;
			}
		});
	});
}

function markTweetAsUnfavourited(tweet_id) {
	var lists = [
		PREFiX.homeTimeline.buffered,
		PREFiX.homeTimeline.tweets,
		PREFiX.mentions.buffered,
		PREFiX.mentions.tweets
	];
	lists.forEach(function(list) {
		list.some(function(tweet) {
			if (tweet.id_str === tweet_id) {
				tweet.favorited = false;
				return true;
			}
		});
	});
}

function deleteTweetFromAllLists(tweet_id) {
	var lists = [
		PREFiX.homeTimeline.buffered,
		PREFiX.homeTimeline.tweets,
		PREFiX.mentions.buffered,
		PREFiX.mentions.tweets
	];
	lists.forEach(function(list) {
		list.some(function(tweet, i) {
			if (tweet.id_str === tweet_id) {
				list.splice(i, 1);
				return true;
			}
		});
	});
}

function onInputStarted() {
	chrome.omnibox.setDefaultSuggestion({
		description: '按回车键发送消息至 Twitter, 按 ↑/↓ 回复指定消息'
	});
	prepareSuggestions();
}

var suggestions = [];
function prepareSuggestions() {
	var users = { };
	function getSpaces(n) {
		return (new Array(n + 1)).join(' ');
	}
	suggestions = PREFiX.homeTimeline.buffered.
		concat(PREFiX.homeTimeline.tweets).
		slice(0, 5).
		map(function(tweet) {
			var _tweet = tweet;
			tweet = tweet.retweeted_status || tweet;
			var text = tweet.text;
			if (tweet.entities && tweet.entities.user_mentions) {
				tweet.entities.user_mentions.forEach(function(mention) {
					text = text.replace('@' + mention.screen_name, function(_) {
						return '<url>' + _ + '</url>';
					});
				});
			}
			if (tweet.entities && tweet.entities.urls) {
				tweet.entities.urls.forEach(function(item) {
					text = text.replace(item.url, '<url>' + item.display_url + '</url>');
				});
			}
			users[tweet.user.screen_name] = users[tweet.user.screen_name] || 0;

			var user = tweet.user.screen_name;

			var cont = '@' + user + getSpaces(++users[user]);

			var desc = '<dim>' + getName(tweet.user) + ': </dim>';
			desc += tweet.photo && tweet.photo.url ? '<url>[Photo]</url> ' : '';
			desc += text + '<dim> - ';
			if (_tweet !== tweet) {
				desc += 'Retweeted by ' + getName(_tweet.user);
			}
			desc += getRelativeTime(_tweet.created_at);
			desc += ' via ' + _tweet.source + '</dim>';

			return {
				content: cont,
				description: desc
			};
		});
}

var delaySuggest = _.throttle(prepareSuggestions, 1000);

function onInputChanged(text, suggest) {
	delaySuggest();
	suggest(suggestions);
}

function onInputEntered(text) {
	var re = /^@([A-Za-z0-9_]{1,15})( +)/g;
	var result = re.exec(text);
	var at_user, spaces;
	var tweet_id;
	if (result) {
		at_user = result[1];
		spaces = result[2];
		var matched_tweets = [];
		PREFiX.homeTimeline.buffered.
		concat(PREFiX.homeTimeline.tweets).
		forEach(function(tweet) {
			tweet = tweet.retweeted_status || tweet;
			if (tweet.user.screen_name === at_user) {
				matched_tweets.push(tweet);
			}
		});
		for (var i = spaces.length; i-- > 0;) {
			if (matched_tweets[i]) {
				tweet_id = matched_tweets[i].id_str;
				break;
			}
		}
	}
	PREFiX.user().postTweet({
		status: text.replace(/\s+/g, ' ').trim(),
		in_reply_to_status_id: tweet_id
	}).next(function(tweet) {
		PREFiX.update();
		showNotification({
			title: '消息已成功发送至 Twitter',
			content: $temp.html(tweet.text).text(),
			timeout: 10000
		}).addEventListener('click', function(e) {
			this.cancel();
		});
	}).error(function(e) {
		var content = '错误原因: ' + e.exceptionType;
		if (e.response && e.response.error) {
			content += ' / ' + e.response.error;
		}
		content += ' (点击这里重试)';
		showNotification({
			title: '消息发送失败',
			content: content,
			timeout: false
		}).addEventListener('click', function(e) {
			this.cancel();
			onInputEntered(text);
		});
	});
}

function updateDetails(flag) {
	var user = Ripple(PREFiX.accessToken);
	var verify = user.verify().next(function(details) {
		lscache.set('account_details', details);
		if (details.friends_count >= 75 && is_first_run) {
			settings.current.autoFlushCache = true;
			settings.save();
		}
		is_first_run = false;
		PREFiX.account = details;
	});
	if (flag) {
		// 延时重试
		verify.
		error(function() {
			setTimeout(function() {
				updateDetails(flag);
			}, 60000);
		});
	}
	return verify;
}

var saved_searches_items = [];
function initSavedSearches() {
	stopSavedSearches();
	function isMentioned(tweet) {
		var result = false;
		if (tweet && tweet.entities) {
			var user_mentions = tweet.entities.user_mentions;
			if (user_mentions) {
				return user_mentions.some(function(user) {
					return user.id_str === PREFiX.account.id_str;
				});
			}
		}
		return result;
	}
	function SavedSearchItem(q) {
		this.keyword = q;
		this.tweets = [];
		this.unread_count = 0;
		this.interval = setInterval(this.check.bind(this), 3 * 60 * 1000);
		this.ajax = null;
		this.check();
	}
	SavedSearchItem.prototype.check = function() {
		if (this.ajax) {
			this.ajax.cancel();
		}
		var self = this;
		var q = this.keyword;
		var last_tweet_id;
		var last_read_tweet_id = +lscache.get('saved-search-' + q + '-id');
		if (this.tweets.length) {
			last_tweet_id = this.tweets[0].id_str;
		}
		this.ajax = getDataSince(
				'searchTweets',
				last_tweet_id,
				this,
				{ q: q },
				90
			).next(function(tweets) {
				if (tweets.length) {
					unshift(self.tweets, tweets);
					if (! last_read_tweet_id) {
						last_read_tweet_id = +tweets[0].id_str;
						lscache.set('saved-search-' + q + '-id', tweets[0].id_str)
					}
				}
				if (! settings.current.showSavedSearchCount) {
					self.unread_count = 0;
					self.tweets.forEach(function(t) {
						t.is_unread = false;
					});
				} else {
					self.unread_count = self.tweets.filter(function(t) {
							t.is_unread = t.user.id !== PREFiX.account.id &&
								t.id > last_read_tweet_id && ! isMentioned(t);
							return t.is_unread;
						}).length;
				}
			});
			var cache_amount = PREFiX.settings.current.tweetsPerPage;
			cache_amount = Math.max(self.unread_count, cache_amount);
			self.tweets.splice(cache_amount);
	}
	SavedSearchItem.prototype.stop = function() {
		if (this.ajax) {
			this.ajax.cancel();
		}
		clearInterval(this.interval);
	}
	PREFiX.user().getSavedSearches().next(function(data) {
		data.forEach(function(saved_search) {
			saved_search = new SavedSearchItem(saved_search.query);
			saved_searches_items.push(saved_search);
		});
	});
	setTimeout(initSavedSearches, 60 * 60 * 1000);
}

function stopSavedSearches() {
	saved_searches_items.forEach(function(item) {
		item.stop();
	});
	saved_searches_items = [];
}

function getSavedSearchTweetsCount() {
	var count = 0;
	saved_searches_items.forEach(function(item) {
		count += item.unread_count;
	});
	return count;
}

function createTab(url) {
	ct.create({
		url: url,
		selected: true
	});
}

function closeTab(id) {
	ct.remove(id);
}

function closeWindow(id) {
	chrome.windows.remove(id);
}

function getDataSince(method, since_id, lock, extra_data, timeout) {
	if (lock) {
		if (lock._ajax_active_) {
			return new Deferred;
		}
		lock.timeout = setTimeout(function() {
			d.fail({
				exceptionType: 'timeout'
			});
			d = new Deferred;
		}, timeout * 1000);
		lock._ajax_active_ = true;
	}

	var d = new Deferred;
	var list = [];
	var get = getInstanceByRateLimit(method);
	var count = 60;

	var data = extra_data || { };
	if (since_id) {
		data.since_id = since_id;
	}
	data.count = count;

	function getBetween() {
		if (! since_id) {
			d.call(list);
			return;
		}
		data.max_id = list[ list.length - 1 ].id_str;
		return get(data).next(function(data) {
				data = data.statuses || data;
 				push(list, data);
				if (data.length < count) {
					d.call(list);
				} else {
					getBetween();
				}
			}).error(function(err) {
				d.fail(err);
			});
	}

	get(data).next(function(data) {
		data = data.statuses || data;
		list = fixTweetList(data);
		if (data.length < count) {
			d.call(list);
		} else {
			getBetween();
		}
	}).error(function(err) {
		d.fail(err);
	});

	return d.error(function(err) {
			if (lock) {
				delete lock._ajax_active_;
				clearTimeout(lock.timeout);
			}
			throw err;
		}).next(function(data) {
			if (lock) {
				delete lock._ajax_active_;
				clearTimeout(lock.timeout);
			}
			return data;
		});
}

function flushCache() {
	if (! settings.current.autoFlushCache)
		return;
	var tl = PREFiX.homeTimeline;
	if (! PREFiX.popupActive && tl.scrollTop < 30) {
		var buffered_count = tl.buffered.length;
		var read_count = tl.tweets.length;
		var cache_amount = settings.current.cacheAmount;
		if (buffered_count + read_count > cache_amount) {
			tl.tweets.splice(Math.max(0, cache_amount - buffered_count));
			if (buffered_count > cache_amount) {
				tl.buffered.splice(cache_amount);
			}
		}
	}
}

function updateTitle() {
	var title = [ 'PREFiX for Twitter' ];

	var tl = PREFiX.homeTimeline;
	var new_tweets = tl.buffered.filter(function(tweet) {
		return ! tweet.is_self;
	});
	if (new_tweets.length) {
		title.push(new_tweets.length + ' 条新推文');
		switchTo('tl_model');
	}

	var saved_searches_count = getSavedSearchTweetsCount();
	if (saved_searches_count) {
		title.push(saved_searches_count + ' 条关注的话题消息');
		switchTo('searches_model');
	}

	var mentions_count = PREFiX.mentions.buffered.filter(function(tweet) {
		return ! tweet.is_self;
	}).length;

	if (mentions_count) {
		switchTo('mentions_model');
		title.push('你被 @ 了 ' + mentions_count + ' 次');
		chrome.browserAction.setBadgeBackgroundColor({
			color: [ 113, 202, 224, 204 ]
		});
	}

	var directmsgs_count = PREFiX.directmsgs.buffered.length;

	if (directmsgs_count) {
		switchTo('directmsgs_model');
		title.push('你有 ' + directmsgs_count + ' 条未读私信');
		chrome.browserAction.setBadgeBackgroundColor({
			color: [ 211, 0, 4, 204 ]
		});
	}

	chrome.browserAction.setBadgeText({
		text: (directmsgs_count || mentions_count || '') + ''
	});
	chrome.browserAction.setTitle({
		title: title.join('\n')
	});
}

function isNeedNotify() {
	var need_notify = false;

	PREFiX.previous_count = PREFiX.count;
	PREFiX.count = {
		mentions: PREFiX.mentions.buffered.filter(function(tweet) {
			return ! tweet.is_self;
		}).length,
		direct_messages: PREFiX.directmsgs.buffered.length
	};

	if (PREFiX.count.mentions) {
		if (PREFiX.count.mentions > PREFiX.previous_count.mentions)
			need_notify = true;
	}

	if (PREFiX.count.direct_messages) {
		if (PREFiX.count.direct_messages > PREFiX.previous_count.direct_messages)
			need_notify = true;
	}

	return need_notify;
}

var update_browser_action_interval;
function updateBrowserAction() {
	chrome.browserAction.getTitle({ }, function(title) {
		var re = /刷新|错误|Rate limit/i;
		if (re.test(title)) return;
		isNeedNotify();
		updateTitle();
	});
}

function resetUpdateInterval() {
	clearInterval(PREFiX.interval);
	PREFiX.interval = setInterval(update, 60000);
}

function setRefreshingState() {
	chrome.browserAction.setBadgeText({
		text: '...'
	});
	chrome.browserAction.setBadgeBackgroundColor({
		color: [ 255, 255, 255, 200 ]
	});
	chrome.browserAction.setTitle({
		title: 'PREFiX for Twitter - 正在刷新'
	});
}

function updateHomeTimeline(retry_chances, new_tweet_id) {
	clearInterval(PREFiX.interval);
	PREFiX.interval = setInterval(update, 60000);

	setRefreshingState();

	var tl = PREFiX.homeTimeline;
	var tweets = fixTweetList(tl.tweets.concat(tl.buffered));
	var latest_tweet = tweets[0];
	var deferred_new = Deferred.next();

	if (latest_tweet) {
		deferred_new = getDataSince('getHomeTimeline', latest_tweet.id_str, tl, null, 45).
			next(function(tweets) {
				if (retry_chances && new_tweet_id) {
					var new_tweet_found = tweets.some(function(t) {
						return t.id_str === new_tweet_id;
					});
					if (! new_tweet_found) {
						setTimeout(function() {
							updateHomeTimeline(--retry_chances, new_tweet_id);
						});
					}
				}
				unshift(tl.buffered, tweets);
				flushCache();
		});
	}

	return deferred_new;
}

function updateMentions() {
	clearInterval(PREFiX.interval);
	PREFiX.interval = setInterval(update, 60000);

	setRefreshingState();

	var mentions = PREFiX.mentions;
	var mention_tweets = fixTweetList(mentions.tweets.concat(mentions.buffered));
	var deferred_mentions = Deferred.next();
	var latest_mention_tweet = mention_tweets[0];

	if (latest_mention_tweet) {
		deferred_mentions = getDataSince('getMentions', latest_mention_tweet.id_str, mentions, null, 45).
			next(function(tweets) {
				unshift(mentions.buffered, tweets);
				fixPosition();
			});
	}

	return deferred_mentions;
}

function updateDirectMsgs() {
	clearInterval(PREFiX.interval);
	PREFiX.interval = setInterval(update, 60000);

	setRefreshingState();

	var directmsgs = PREFiX.directmsgs;
	var dms = fixTweetList(directmsgs.messages.concat(directmsgs.buffered));
	var deferred_dm = Deferred.next();
	var latest_dm = dms[0];

	if (latest_dm) {
		deferred_dm = getDataSince('getDirectMessages', latest_dm.id_str, directmsgs, null, 45).
			next(function(messages) {
				unshift(directmsgs.buffered, messages);
				fixPosition();
			});
	}

	return deferred_dm;
}

function initStreamingAPI() {
	var processed_index = -1;
	var friends = [];
	function notify(options) {
		if (! settings.current.notification)
			return;
		var is_mention_or_dm = [ 'mention', 'directmsg' ].indexOf(options.type) > -1;
		if (is_mention_or_dm) {
			if (PREFiX.popupActive && (! PREFiX.panelMode || PREFiX.is_popup_focused))
				return;
		}
		if (options.type === 'mention' && ! settings.current.notif_mention)
			return;
		if (options.type === 'directmsg' && ! settings.current.notif_directmsg)
			return;
		if (options.type === 'retweet' && ! settings.current.notif_retweet)
			return;
		if (options.type === 'friend' && ! settings.current.notif_follower)
			return;
		if (options.type === 'favourite' && ! settings.current.notif_favourite)
			return;
		showNotification(options).addEventListener('click', function(e) {
			this.cancel();
			if (options.url) {
				createTab(options.url);
			}
			if (! is_mention_or_dm)
				return;
			if (PREFiX.panelMode) {
				chrome.tabs.query({
					url: panel_url
				}, function(tabs) {
					tabs.forEach(function(tab) {
						chrome.windows.update(tab.windowId, {
							focused: true
						});
					});
				});
				getPanelWindow(function(view) {
					var selector = '#navigation-bar ';
					if (options.type === 'mention') {
						selector += '.mentions';
					} else if (options.type === 'directmsg') {
						selector += '.directmsgs';
					}
					var elem = view.$(selector)[0];
					var event = new Event('click');
					elem.dispatchEvent(event);
				});
			} else {
				createPopup();
			}
		});
	}
	function process(data) {
		if (! data || ! data.trim().length)
			return;
		PREFiX.streamingApiActived = Date.now();
		try {
			data = JSON.parse(data);
		} catch (e) {
			console.log('failed to parse data', data);
			throw e;
		}

		if (data.delete) {
			setTimeout(function() {
				if (data.delete.status) {
					batchProcess(function(view) {
						view.deleteTweetFromAllLists && view.deleteTweetFromAllLists(data.delete.status.id_str);
					});
					isNeedNotify();
					updateTitle();
				}
			}, 2000);
		} else if (data.disconnect) {
			stopStreamingAPI();
		} else if (data.limit) {
		} else if (data.scrub_geo) {
		} else if (data.warning) {
		} else if (data.status_withheld) {
		} else if (data.user_withheld) {
		} else if (data.friends) {
			update();
			friends = data.friends;
		} else if (data.friends_str) {
			update();
			friends = data.friends_str;
		} else if (data.direct_message) {
			var dm = data.direct_message;
			Ripple.events.trigger('process_tweet', dm);
			if (dm.recipient_id_str === PREFiX.account.id_str) {
				unshift(PREFiX.directmsgs.buffered, [ dm ])
				if (isNeedNotify()) {
					playSound();
				}
				if (! dm.filtered_out) {
					notify({
						type: 'directmsg',
						title: '收到 ' + getName(dm.sender) + '发来的私信',
						content: dm.textWithoutTags,
						icon: dm.sender.profile_image_url_https
					});
				}
				isNeedNotify();
				updateTitle();
			}
		} else if (data.event) {
			var ev = data.event
			if (ev === 'blocked') {
			} else if (ev === 'unblocked') {
			} else if (ev === 'favorite') {
				Ripple.events.trigger('process_tweet', data.target_object);
				if (data.source.id_str === PREFiX.account.id_str) {
					batchProcess(function(view) {
						view.markTweetAsFavourited && view.markTweetAsFavourited(data.target_object.id_str);
					});
				} else {
					notify({
						type: 'favourite',
						title: getName(data.source) + '收藏了你的消息',
						content: data.target_object.textWithoutTags,
						icon: data.source.profile_image_url_https
					});
				}
			} else if (ev === 'unfavorite') {
				if (data.source.id_str === PREFiX.account.id_str) {
					batchProcess(function(view) {
						view.markTweetAsUnfavourited && view.markTweetAsUnfavourited(data.target_object.id_str);
					});
				}
			} else if (ev === 'follow') {
				if (data.source.id_str === PREFiX.account.id_str) {
					friends.push(data.target.id_str);
				} else {
					notify({
						type: 'friend',
						title: getName(data.source) + '关注了你',
						content: data.source.description,
						url: 'https://twitter.com/' + data.source.screen_name,
						icon: data.source.profile_image_url_https
					});
				}
			} else if (ev === 'unfollow') {
				var i = friends.indexOf(data.target.id_str);
				friends.splice(i, 1);
			} else if (ev === 'user_update') {
				PREFiX.account = data.target;
				lscache.set('account_details', data.target);
			} else if (ev === 'list_created') {
			} else if (ev === 'list_destroyed') {
			} else if (ev === 'list_updated') {
			} else if (ev === 'list_member_added') {
			} else if (ev === 'list_member_removed') {
			} else if (ev === 'list_user_subscribed') {
			} else if (ev === 'list_user_unsubscribed') {
			} else {
			}
		} else {
			Ripple.events.trigger('process_tweet', data);
			if (data.photo && data.photo.url) {
				data.textWithoutTags += '[Photo]'
			}
			var user_id = data.user.id_str;
			if (data.retweeted_status && user_id === PREFiX.account.id_str) {
				data.retweeted = true;
			}
			var is_retweeted_from_me = false;
			if (data.retweeted_status && data.retweeted_status.is_self) {
				is_retweeted_from_me = true;
			}
			if (is_retweeted_from_me) {
				// 有人锐推了自己的消息
				if (! data.filtered_out) {
					notify({
						type: 'retweet',
						title: getName(data.user) + '锐推了你的消息',
						content: data.retweeted_status.textWithoutTags,
						icon: data.user.profile_image_url_https
					});
				}
			} else {
				var mentioned = data.entities.user_mentions.some(function(mention) {
					return mention.id_str === PREFiX.account.id_str;
				});
				if (! mentioned && data.retweeted_status) {
					mentioned = data.retweeted_status.entities.user_mentions.some(function(mention) {
						return mention.id_str === PREFiX.account.id_str;
					});
				}
				var is_retweeted_from_friend = data.retweeted_status &&
					friends.indexOf(data.retweeted_status.user.id_str) > -1;
				// 有人锐推了好友的未提到自己的消息, 忽略
				if (is_retweeted_from_friend && ! mentioned) {
					return;
				}
				if (friends.indexOf(user_id) > -1 || ! friends.length ||
					data.is_self) {
					// 有人锐推了提到自己的好友的消息
					if (data.retweeted_status &&
						(friends.indexOf(data.retweeted_status.user.id_str) > -1 ||
						data.is_self)) {
						if (is_retweeted_from_friend && ! data.is_self) {
							// 好友锐推了提到自己的好友的消息
							if (! data.filtered_out) {
								notify({
									type: 'retweet',
									title: getName(data.user) + '锐推了提到你的消息',
									content: getName(data.retweeted_status.user) + ': ' +
										data.retweeted_status.textWithoutTags
								});
							}
						}
						if (data.is_self &&
							friends.indexOf(data.retweeted_status.user.id_str) === -1) {
							// 自己锐推的非好友的消息
							unshift(PREFiX.homeTimeline.buffered, [ data ]);
							flushCache();
						}
						return;
					}
					// 好友和自己的消息, 加入 home-timeline
					unshift(PREFiX.homeTimeline.buffered, [ data ]);
					flushCache();
				}
				// 提到了自己的消息
				if (mentioned) {
					if (data.retweeted_status) {
						if (! data.is_self && ! data.filtered_out) {
							// 锐推的非自己的消息
							notify({
								type: 'retweet',
								title: getName(data.user) + '锐推了提到你的消息',
								content: getName(data.retweeted_status.user) + ': ' +
									data.retweeted_status.textWithoutTags
							});
						}
					} else {
						// 提到自己的非锐推的消息
						unshift(PREFiX.mentions.buffered, [ data ]);
						if (! data.is_self) {
							// 非锐推非自己的消息
							if (isNeedNotify()) {
								playSound();
							}
							if (! data.filtered_out) {
								notify({
									type: 'mention',
									title: getName(data.user) + '提到了你',
									content: data.textWithoutTags,
									icon: data.user.profile_image_url_https
								});
							}
						}
					}
				}
				isNeedNotify();
				updateTitle();
			}
		}
	}
	PREFiX.streamingAjax = getDefaultInstance().streamingAPI({
		method: 'GET',
		action: 'https://userstream.twitter.com/1.1/user.json',
		params: {
			stringify_friend_ids: true
		},
		callback: function(e) {
			var data = this.responseText;
			if (! data) return;
			resetUpdateInterval();
			var parsed_data = data.split('\r\n');
			for (var i = processed_index + 1; true; i++) {
				if (parsed_data[i + 1] !== undefined) {
					processed_index = i;
					try {
						process(parsed_data[i]);
					} catch (e) { }
				} else {
					break;
				}
			}
		}
	}).hold(function(e) {
		if (PREFiX.account) {
			console.log('error thrown connecting to streaming api', e)
			if (! e || e.exceptionType === 'onabort') {
				initStreamingAPI();
			} else {
				setTimeout(initStreamingAPI, 60 * 1000);
			}
		}
	});
}

function stopStreamingAPI() {
	if (PREFiX.streamingAjax) {
		PREFiX.streamingAjax.cancel();
		PREFiX.streamingAjax = null;
	}
}

function getName(user) {
	var title = [ user.name, '@' + user.screen_name ];
	if (settings.current.screenNameFirst) {
		title.reverse();
	}
	return title.join(' (') + ') ';
}

function update() {
	var d = new Deferred;

	resetUpdateInterval();

	setRefreshingState();

	var dl = [
		updateHomeTimeline(),
		updateMentions(),
		updateDirectMsgs()
	].map(function(d) {
		return d.error(function(e) {
			var prefix = 'PREFiX for Twitter - ';
			var default_error = prefix + '网络连接断开或内部错误';
			var error;
			if (e && Ripple.helpers.isString(e.response)) {
				error = e.response;
			} else if (e && e.response && e.response.errors) {
				error = (e.response.errors[0] || { }).message;
			}
			chrome.browserAction.setBadgeText({
				text: ' '
			});
			chrome.browserAction.setBadgeBackgroundColor({
				color: [ 255, 0, 0, 200 ]
			});
			chrome.browserAction.setTitle({
				title: error ? prefix + error : default_error
			});
			throw e;
		});
	});

	Deferred.parallel(dl).
	hold(function() {
		if (isNeedNotify()) {
			playSound();
			if (settings.current.notification) {
				var is_dm = !! PREFiX.count.direct_messages;
				var content = '您有 ';
				content += PREFiX.count.direct_messages || PREFiX.count.mentions;
				content += ' 条未读';
				content += is_dm ? '私信' : ' @ 消息';
				if (! PREFiX.popupActive || (PREFiX.panelMode && ! PREFiX.is_popup_focused)) {
					showNotification({
						content: content,
						id: 'notification'
					}).addEventListener('click', function(e) {
						this.cancel();
						if (PREFiX.panelMode) {
							var url = chrome.extension.getURL('/popup.html?new_window=true');
							chrome.tabs.query({
								url: url
							}, function(tabs) {
								tabs.forEach(function(tab) {
									chrome.windows.update(tab.windowId, {
										focused: true
									});
								});
							});
							var views = chrome.extension.getViews();
							views.some(function(view) {
								if (view.location.href == url) {
									var selector = '#navigation-bar ';
									selector += is_dm ? '.directmsgs' : '.mentions';
									var elem = view.$(selector)[0];
									var event = new Event('click');
									elem.dispatchEvent(event);
									return true;
								}
							});
						} else {
							createPopup();
						}
					});
				}
			}
		}
	}).
	next(function() {
		updateTitle();
		d.call();
	}).error(function(e) {
		var time = getShortTime(new Date);
		console.log('Error thrown @ ' + time, e);
	});

	return d;
}

function loadFriends() {
	var friends = {};
	[ 'Friends', 'Followers' ].forEach(function(type) {
		(function get(cursor) {
			PREFiX.user()['get' + type]({
				screen_name: PREFiX.account.screen_name,
				skip_status: true,
				include_user_entities: false,
				count: 200,
				cursor: cursor
			}).next(function(data) {
				var users = data.users.map(function(user) {
					return {
						name: user.name,
						id: user.id,
						screen_name: user.screen_name,
						string: user.screen_name + ' ' + user.name,
						following: user.following
					};
				}).filter(function(user) {
					if (friends[user.screen_name]) return false;
					friends[user.screen_name] = true;
					return true;
				});
				PREFiX.friends.push.apply(PREFiX.friends, users);
				var next_cursor = data.next_cursor_str;
				if (next_cursor && next_cursor !== '0') {
					get(next_cursor);
				}
			});
		})('-1');
	});
}

function processPhoto(tweet, photo) {
	var width = photo.width;
	var height = photo.height;
	if (width > 120 || height > 120) {
		if (width > height) {
			var k = width / 120;
			width = 120;
			height = Math.round(height / k);
		} else {
			var k = height / 120;
			height = 120;
			width = Math.round(width / k);
		}
	}
	photo.thumb_size = {
		width: width,
		height: height
	};
	var img_thumb = new Image;
	img_thumb.src = photo.thumbnail_url || photo.url;
	photo.url_large = isZoomAble(photo.url) ?
		getLargeImage(photo.url) : photo.url;
	photo.url = photo.thumbnail_url || photo.url_large;
	if (photo.url_large !== img_thumb.src) {
		var img_large = new Image;
		img_large.src = photo.url_large;
	}
	tweet.photo = tweet.photo || { };
	if (tweet.photo.url) return;
	$.extend(true, tweet.photo, photo);
	return photo;
}

function getNaturalDimentions(url, callback) {
	var image = new Image;
	image.src = url;
	waitFor(function() {
		return image.naturalWidth;
	}, function() {
		callback({
			width: image.naturalWidth,
			height: image.naturalHeight
		});
		image.src = '';
		image = null;
	});
}

var getOEmbed = (function() {
	this.oEmbed_lib = [];

	function OEmbed(url) {
		this.url = url;
		this.status = 'initialized';
		this.callbacks = [];
		this.fetch();
		oEmbed_lib.push(this);
	}

	OEmbed.prototype.fetch = function fetch() {
		var self = this;
		var url = this.longUrl || this.url;
		this.status = 'loading';

		if (! isPhotoLink(url)) {
			short_url_re = PREFiX.shortUrlRe || short_url_re;
			if (short_url_re.test(url)) {
				expandUrl(url).next(function(long_url) {
					if (self.longUrl && self.longUrl === long_url)
						return;
					self.longUrl = long_url;
					fetch.call(self);
				});
				return;
			}

			self.status = 'ignored';
			lscache.set('oembed-' + url, self);
			return;
		}

		var result = url.match(instagram_re);
		if (result) {
			var image_url = result[0] + 'media/';
			image_url = image_url.replace('instagr.am', 'instagram.com');
			loadImage({
				url: self.url,
				large_url: image_url + '?size=l',
				thumbnail_url: image_url + '?size=t',
				oEmbed: self
			});
			return;
		}

		var result = url.match(pinsta_re);
		if (result) {
			var id = result[1];
			Ripple.ajax.get(url).
			next(function(html) {
				var $html = $(html);
				var large_url;
				var thumbnail_url;
				[].some.call($html.find('script'), function(script) {
					var code = script.textContent;
					if (code.indexOf('var mediaJson') > -1) {
						code = code.match(/var mediaJson = ([^;]+);/)[1];
						var media_json = JSON.parse(code);
						media_json.some(function(item) {
							if (item.id === id) {
								large_url = item.images.standard_resolution;
								thumbnail_url = item.images.thumbnail;
								return true;
							}
						});
						return true;
					}
				});
				$html.length = 0;
				$html = null;
				if (large_url) {
					loadImage({
						url: self.url,
						large_url: large_url,
						thumbnail_url: thumbnail_url,
						oEmbed: self
					});
				} else {
					self.status = 'ignored';
					lscache.set('oembed-' + url, self);
				}
			});
			return;
		}

		var result = url.match(weibo_re);
		if (result) {
			var large_url = url.replace(/\/(?:mw1024|bmiddle|thumbnail)\//, '/large/');
			loadImage({
				url: self.url,
				large_url: large_url,
				thumbnail_url: large_url.replace('/large/', '/thumbnail/'),
				oEmbed: self
			});
			return;
		}

		var result = url.match(fanfou_re);
		if (result) {
			Ripple.ajax.get(url).
			next(function(html) {
				var $html = $(html);
				var large_url = $html.find('#photo img').attr('src');
				$html.length = 0;
				$html = null;
				if (large_url) {
					loadImage({
						url: self.url,
						large_url: large_url,
						oEmbed: self
					});
				} else {
					self.status = 'ignored';
					lscache.set('oembed-' + url, self);
				}
			});
			return;
		}

		var result = url.match(twitpic_re);
		if (result) {
			var full_url = url;
			if (! /\/full$/.test(url)) {
				full_url += '/full';
				full_url = full_url.replace('//', '/');
			}
			Ripple.ajax.get(full_url).
			next(function(html) {
				var $html = $(html);
				var large_url = $html.find('#media-full img').attr('src');
				$html.length = 0;
				$html = null;
				if (large_url) {
					loadImage({
						url: self.url,
						large_url: large_url,
						oEmbed: self
					});
				} else {
					self.status = 'ignored';
					lscache.set('oembed-' + url, self);
				}
			});
			return;
		}

		var result = url.match(imgly_re);
		if (result) {
			Ripple.ajax.get(url).
			next(function(html) {
				var $html = $(html);
				var full_url = $html.find('#button-fullview a').attr('href');
				$html.length = 0;
				$html = null;
				if (! /^http/.test(full_url)) {
					full_url = 'http://img.ly' + full_url;
				}
				Ripple.ajax.get(full_url).next(function(html) {
					var $html = $(html);
					var large_url = $html.find('#image-full img').attr('src');
					$html.length = 0;
					$html = null;
					if (large_url) {
						loadImage({
							url: self.url,
							large_url: large_url,
							oEmbed: self
						});
					} else {
						self.status = 'ignored';
						lscache.set('oembed-' + url, self);
					}
				})
			});
			return;
		}

		var result = url.match(lofter_re);
		if (result) {
			Ripple.ajax.get(url).
			next(function(html) {
				var $html = $(html);
				var large_url = $html.find('[bigimgsrc]').attr('bigimgsrc');
				$html.length = 0;
				$html = null;
				if (large_url) {
					loadImage({
						url: self.url,
						large_url: large_url,
						oEmbed: self
					});
				} else {
					self.status = 'ignored';
					lscache.set('oembed-' + url, self);
				}
			});
			return;
		}

		var result = url.match(imgur_re);
		if (result) {
			Ripple.ajax.get(url).
			next(function(html) {
				html = html.replace(/(src|href)="\/\//g, function(_, $1) {
					return $1 + '="http://';
				});
				var $html = $(html);
				var large_url = $html.find('#image a').prop('href');
				large_url = large_url || $html.find('#image img').prop('src');
				$html.length = 0;
				$html = null;
				if (large_url) {
					loadImage({
						url: self.url,
						large_url: large_url,
						oEmbed: self
					});
				} else {
					self.status = 'ignored';
					lscache.set('oembed-' + url, self);
				}
			});
			return;
		}

		var result = url.match(twipple_re);
		if (result) {
			var large_url = url.replace('p.twipple.jp', 'p.twpl.jp/show/orig');
			loadImage({
				url: self.url,
				large_url: large_url,
				oEmbed: self
			});
			return;
		}

		var result = url.match(tinypic_re);
		if (result) {
			Ripple.ajax.get(url).
			next(function(html) {
				var $html = $(html);
				var large_url = $html.find('#imgFrame a').prop('href');
				$html.length = 0;
				$html = null;
				if (large_url) {
					loadImage({
						url: self.url,
						large_url: large_url,
						oEmbed: self
					});
				} else {
					self.status = 'ignored';
					lscache.set('oembed-' + url, self);
				}
			});
			return;
		}

		var result = url.match(path_re);
		if (result) {
			Ripple.ajax.get(url).
			next(function(html) {
				var $html = $(html);
				var large_url = $html.find('.photo-container img').attr('src');
				$html.length = 0;
				$html = null;
				if (large_url) {
					loadImage({
						url: self.url,
						large_url: large_url,
						oEmbed: self
					});
				} else {
					self.status = 'ignored';
					lscache.set('oembed-' + url, self);
				}
			});
			return;
		}

		var result = url.match(flickr_re);
		if (result) {
			Ripple.ajax.get(url).
			next(function(html) {
				function createPhotoURL(size) {
					var url;
					if (size.secret) {
						url = base_url.replace(/_.*\.jpg$/, '_' + size.secret + size.fileExtension + '.jpg');
					} else {
						url = base_url.replace(/\.jpg$/, size.fileExtension + '.jpg');
					}
					if (size.queryString) {
						url += size.queryString;
					}
					return url;
				}
				var result = html.match(/baseURL: '(\S+)',/);
				var base_url = result && result[1];
				var result = html.match(/sizeMap: (\[[^\]]+\])/);
				var size_map = result && JSON.parse(result[1]);
				var size_t = size_map[0];
				var size_l = size_map.reverse()[0];
				var large_url = createPhotoURL(size_l);
				var thumbnail_url = createPhotoURL(size_t);
				if (large_url) {
					loadImage({
						url: self.url,
						large_url: large_url,
						thumbnail_url: thumbnail_url,
						oEmbed: self
					});
				} else {
					self.status = 'ignored';
					lscache.set('oembed-' + url, self);
				}
			});
			return;
		}

		var result = picture_re.test(url);
		if (result) {
			loadImage({
				url: self.url,
				large_url: url,
				oEmbed: self
			});
			return;
		}

		if (! settings.current.embedlyKey) {
			this.status = 'error';
			return;
		}

		this.ajax = Ripple.ajax(
			'http://api.embed.ly/1/oembed',
			{
				method: 'GET',
				params: {
					key: settings.current.embedlyKey,
					url: url,
					format: 'json'
				},
				success: function(data) {
					data = data || { };
					if (data.type !== 'photo' && data.thumbnail_url) {
						if (! data.width && ! data.height) {
							data.type = 'photo';
							data.width = data.thumbnail_width;
							data.height = data.thumbnail_height;
							data.url = data.thumbnail_url;
						}
					}
					if (data.type === 'photo') {
						self.status = 'completed';
						self.data = data;
					} else {
						self.status = 'ignored';
					}
					lscache.set('oembed-' + url, self);
					self.call();
				},
				error: function(e) {
					if (e.status) {
						self.status = 'ignored';
					} else {
						self.status = 'error';
					}
					lscache.set('oembed-' + url, self);
				}
			}
		);
	}

	OEmbed.prototype.call = function() {
		var callback;
		while (callback = this.callbacks.shift()) {
			callback();
		}
	}

	OEmbed.prototype.done = function(callback) {
		if (this.status === 'ignored')
			return;
		if (this.status === 'error') {
			this.fetch();
		}
		if (this.status === 'loading') {
			this.callbacks.push(callback);
		} else if (this.status === 'completed') {
			setTimeout(callback);
		}
	}

	function process(tweet, oEmbed) {
		tweet.oEmbedProcessed = true;
		if (! oEmbed.data) return;
		var data = oEmbed.data;
		processPhoto(tweet, {
			url: data.url,
			thumbnail_url: data.thumbnail_url,
			width: data.width,
			height: data.height
		});
	}

	function loadImage(options) {
		var oEmbed = options.oEmbed;
		var image_url = options.thumbnail_url || options.large_url;
		getNaturalDimentions(image_url, function(dimentions) {
			oEmbed.data = {
				url: options.large_url,
				width: dimentions.width,
				height: dimentions.height,
				type: 'photo',
				thumbnail_url: options.thumbnail_url
			};
			oEmbed.status = 'completed';
			lscache.set('oembed-' + options.url, oEmbed);
			setTimeout(function() {
				oEmbed.call();
			});
		});
	}

	var instagram_re = /https?:\/\/(instagram\.com|instagr.am)\/p\/[a-zA-Z0-9_]+\//;
	var pinsta_re = /https?:\/\/pinsta\.me\/p\/([a-zA-Z0-9_]+)/;
	var fanfou_re = /https?:\/\/fanfou\.com\/photo\//;
	var weibo_re = /https?:\/\/[w0-9]+\.sinaimg\.cn\/\S+\.jpg/;
	var twitpic_re = /https?:\/\/(?:www\.)?twitpic\.com\//;
	var imgly_re = /https?:\/\/img\.ly\//;
	var lofter_re = /\.lofter\.com\/post\/[a-zA-Z0-9_]+/;
	var imgur_re = /imgur\.com\//;
	var twipple_re = /https?:\/\/p\.twipple\.jp\/\S+/;
	var tinypic_re = /tinypic\.com\//;
	var path_re = /https?:\/\/path\.com\/p\//;
	var flickr_re = /https?:\/\/(?:www\.)?flickr\.com\/photos\//;
	var picture_re = /\.(?:jpg|jpeg|png|gif|webp)(?:\??\S*)?$/i;

	var photo_res = [
		weibo_re,
		/\.(?:jpg|jpeg|gif|png|bmp|webp)/i,
		twitpic_re,
		imgly_re,
		tinypic_re,
		flickr_re,
		instagram_re,
		pinsta_re,
		/yfrog\./,
		twipple_re,
		/https?:\/\/twitgoo\.com\//,
		/https?:\/\/(?:s\w+|i\w+|media)\.photobucket\.com\/(?:albums|image)\//,
		/https?:\/\/facebook\.com|fb\.me/,
		path_re,
		/tumblr\.com\//,
		imgur_re,
		/https?:\/\/picasaweb\.google\.com/,
		/https?:\/\/(?:www\.mobypicture\.com\/user|moby\.to)\//,
		/https?:\/\/meadd\.com\//,
		/deviantart\.(?:com|net)|https?:\/\/fav\.me\//,
		/https?:\/\/(?:www\.)?fotopedia\.com\//,
		fanfou_re,
		lofter_re,
		/https?:\/\/(?:imgs\.|www\.|)xkcd\.com\//,
		/https?:\/\/(?:www)?\.asofterworld\.com\//,
		/https?:\/\/www\.qwantz\.com\//,
		/https?:\/\/(?:www\.|)23hq\.com\//,
		/https?:\/\/drbl\.in\/|dribbble\.com\/shots\//,
		/\.smugmug\.com\//,
		/fotopedia\.com\//,
		/https?:\/\/photozou\.jp\/photo\//,
		/https?:\/\/(?:img\.)?skitch\.com\//,
		/https?:\/\/(?:www\.)?questionablecontent\.net\//,
		/twitrpix\.com\//,
		/https?:\/\/(?:www\.)?(?:someecards\.com|some\.ly)\//,
		/https?:\/\/pikchur\.com\//,
		/https?:\/\/mlkshk\.com\/p\//,
		/https?:\/\/(?:pics\.)?lockerz\.com\/s\//,
		/https?:\/\/d\.pr\/i\//,
		/https?:\/\/www\.eyeem\.com\/[pau]\//,
		/https?:\/\/(?:giphy\.com\/gifs|gph\.is)\//,
		/https?:\/\/frontback\.me\/p\//,
		picture_re
	];

	function isPhotoLink(url) {
		return photo_res.some(function(re) {
				return re.test(url);
			});
	}

	return function(tweet) {
		if (tweet.oEmbedProcessed)
			return;
		if (! tweet.entities || ! tweet.entities.urls.length)
			return;
		short_url_re = PREFiX.shortUrlRe || short_url_re;
		tweet.entities.urls.forEach(function(item) {
			var url = item.expanded_url;
			if (! url.split('/')[3]) return;
			var is_short_url = short_url_re.test(url);
			var is_photo_link = isPhotoLink(url) || is_short_url;
			if (! is_photo_link) return;
			var cached, oEmbed;
			oEmbed_lib.some(function(oembed) {
				if (oembed.url === url) {
					cached = oembed;
					return true;
				}
			});
			var ls_cached = lscache.get('oembed-' + url);
			cached = cached || ls_cached;
			if (cached) {
				cached.__proto__ = OEmbed.prototype;
				cached.done(function() {
					process(tweet, cached);
				});
				oEmbed = cached;
			} else {
				oEmbed = new OEmbed(url);
				oEmbed.done(function() {
					process(tweet, oEmbed);
				});
			}
			if (is_short_url) {
				setTimeout(function() {
					waitFor(function() {
						return oEmbed.longUrl;
					}, function() {
						var text = tweet.fixedText;
						$temp.html(text);
						var $link = $temp.find('[href="' + oEmbed.url + '"]');
						$link.prop('title', oEmbed.longUrl);
						$link.prop('href', oEmbed.longUrl);
						var display_url = oEmbed.longUrl.replace(/^https?:\/\/(?:www\.)?/, '');
						if (display_url.length > 25) {
							display_url = display_url.substring(0, 25) + '...';
						}
						$link.text(display_url);
						tweet.fixedText = $temp.html();
					});
				});
			}
		});
	}
})();

var cropAvatar = (function() {
	var avatars = [];

	function Avatar(url) {
		this.url = url;
		this.callbacks = [];
		this.fetch();
		avatars.push(this);
	}

	Avatar.prototype.fetch = function() {
		var self = this;
		this.status = 'loading';
		var img = new Image;
		img.src = this.url;
		var timeout = setTimeout(function() {
			self.status = 'error';
		}, 15000);
		waitFor(function() {
			return (img.naturalWidth && img.naturalHeight) ||
				self.status === 'error';
		}, function() {
			if (self.status === 'error')
				return;
			self.status = 'completed';
			clearTimeout(timeout);
			self.width = img.naturalWidth;
			self.height = img.naturalHeight;
			img.src = '';
			img = null;
			self.call();
		});
	}

	Avatar.prototype.done = function(callback) {
		if (this.status === 'error') {
			this.fetch();
		}
		this.callbacks.push(callback);
		if (this.status === 'completed') {
			this.call();
		}
	}

	Avatar.prototype.call = function() {
		var callback;
		while (callback = this.callbacks.shift()) {
			callback();
		}
	}

	function process(tweet, avatar) {
		tweet.avatarProcessed = true;
		var width = avatar.width;
		var height = avatar.height;
		if (width > height) {
			var k = height / 48;
			height = 48;
			width = Math.round(width / k);
		} else {
			var k = width / 48;
			width = 48;
			height = Math.round(height / k);
		}
		tweet.avatar_size.width = width + 'px';
		tweet.avatar_size.height = height + 'px';
		tweet.avatar_margin.left = (48 - width) / 2 + 'px';
		tweet.avatar_margin.top = (48 - height) / 2 + 'px';
	}

	return function(tweet, url) {
		if (tweet.avatarProcessed)
			return;
		var avatar;
		avatars.some(function(a) {
			if (a.url === url) {
				avatar = a;
				return true;
			}
		});
		avatar = avatar || new Avatar(url);
		avatar.done(function() {
			process(tweet, avatar);
		});
	}
})();

var cached_res = { };
function prepareRE(str) {
	if (cached_res[str]) {
		return cached_res[str];
	}
	var re = /^\/(\S+)\/([igm]*)$/;
	if (re.test(str)) {
		var result = str.match(re);
		re = new RegExp(result[1], result[2] || '');
	} else {
		re = new RegExp(
			str.
			replace(/(\.|\||\+|\{|\}|\[|\]|\(|\)|\\)/g, '\\$1').
			replace(/\?/g, '.').
			replace(/\*/g, '.*'),
			'i'
		);
	}
	cached_res[str] = re;
	return re;
}

function filterOut(tweet) {
	if (tweet.is_self) {
		tweet.filtered_out = false;
		return;
	}
	settings.current.filters.some(function(filter) {
		var re = prepareRE(filter.pattern);
		var str = '';
		switch (filter.type) {
			case 'screen_name':
				str = (tweet.user || tweet.sender).screen_name;
				break;
			case 'name':
				str = (tweet.user || tweet.sender).name;
				break;
			case 'content':
				str = tweet.fixedText;
				break;
			case 'client':
				str = tweet.source;
				break;
		}
		var result = re.test(str);
		if (! result && tweet.retweeted_status) {
			var retweeted = tweet.retweeted_status;
			switch (filter.type) {
				case 'screen_name':
					str = retweeted.user.screen_name;
					break;
				case 'name':
					str = retweeted.user.name;
					break;
				case 'content':
					str = retweeted.fixedText;
					break;
				case 'client':
					str = retweeted.source;
					break;
			}
			result = re.test(str);
			retweeted.filtered_out = result;
		}
		tweet.filtered_out = result;
		return result;
	});
}

function filterOutAllLists() {
	var lists = [
		PREFiX.homeTimeline,
		PREFiX.mentions,
		PREFiX.directmsgs
	];
	lists.forEach(function(list) {
		[ 'buffered', 'tweetes', 'messages' ].forEach(function(type) {
			if (! list[type]) return;
			list[type] = list[type].filter(function(tweet) {
				filterOut(tweet);
				return ! tweet.filtered_out;
			});
		});
	});
}

var cloud_sync_initialized = false;
function initCloudSync() {
	if (cloud_sync_initialized) return;
	cloud_sync_initialized = true;
	var re = /prefix_for_twitter_(\d+)_read_position/;
	chrome.storage.sync.get(null, function(items) {
		for (var key in items) {
			var result = key.match(re);
			if (! result) continue;
			var id_str = result[1];
			var read_position = items[key];
			setReadPosition(id_str, read_position, 'init');
		}
		chrome.storage.onChanged.addListener(function(changes, namespace) {
			console.log(arguments)
			for (var key in changes) {
				var result = key.match(re);
				if (! result) continue;
				var id_str = result[1];
				var storage_change = changes[key];
				setReadPosition(id_str, storage_change.newValue, 'sync');
			}
		});
	});
}

function generateFakeId(id) {
	var fake_id = (id + '').split('').reverse();
	fake_id.splice(2, 0, '.');
	fake_id = parseFloat(fake_id.reverse().join(''));
	return fake_id;
}

function fixPosition() {
	var read_position = loadReadPosition();
	setReadPosition(current_id, read_position, 'fix');
}

function setPosition(id, list, read_list, unread_list) {
	var fake_id = generateFakeId(id);
	var all_items = fixTweetList(list[unread_list].concat(list[read_list]));
	var read_items = [];
	var unread_items = [];
	all_items.forEach(function(item) {
		var item_fake_id = generateFakeId(item.id_str);
		if (item_fake_id <= fake_id) {
			read_items.push(item);
		} else {
			unread_items.push(item);
		}
	});
	list[read_list] = fixTweetList(read_items);
	list[unread_list] = fixTweetList(unread_items);
}

function setReadPosition(id, read_position, flag) {
	lscache.set('read_position_' + id, read_position);
	if (! flag || [ 'init', 'sync', 'fix' ].indexOf(flag) > -1) {
		if (id === current_id) {
			if (read_position.mentions) {
				var mentions = PREFiX.mentions;
				setPosition(read_position.mentions, mentions, 'tweets', 'buffered');
			}
		}
	}
	if (! flag) {
		var key = 'prefix_for_twitter_' + id + '_read_position';
		var data = { };
		data[key] = read_position;
		console.log('sync set', data)
		chrome.storage.sync.set(data, function(data) {
			console.log('synced', arguments)
		});
		console.log('test')
	}
}

function loadReadPosition() {
	if (! current_id) return { };
	return lscache.get('read_position_' + current_id) || {};
}

var init_interval;
var _initData = function() { }
function initData() {
	return _initData();
}

function load() {
	if (PREFiX.loaded) return;
	PREFiX.loaded = true;
	current_id = PREFiX.account.id_str;
	initCloudSync();
	PREFiX.count = {
		mentions: 0,
		direct_messages: 0
	};
	PREFiX.friends = [];
	_initData = function() {
		PREFiX.user().getHomeTimeline({
			count: PREFiX.settings.current.tweetsPerPage
		}).setupAjax({
			lock: initData
		}).next(function(tweets) {
			if (! PREFiX.homeTimeline.tweets.length) {
				PREFiX.homeTimeline.tweets = fixTweetList(tweets);
			}
			_initData = function() {
				var read_position = loadReadPosition();
				PREFiX.user().getMentions({
					count: PREFiX.settings.current.tweetsPerPage,
					max_id: read_position.mentions
				}).setupAjax({
					lock: initData
				}).next(function(tweets) {
					if (! PREFiX.mentions.tweets.length) {
						PREFiX.mentions.tweets = fixTweetList(tweets);
					}
					_initData = function() {
						var read_position = loadReadPosition();
						PREFiX.user().getDirectMessages({
							count: PREFiX.settings.current.tweetsPerPage,
							max_id: read_position.directmsgs
						}).setupAjax({
							lock: initData
						}).next(function(messages) {
							if (! PREFiX.directmsgs.messages.length) {
								PREFiX.directmsgs.messages = fixTweetList(messages);
							}
							clearInterval(init_interval);
							initStreamingAPI();
						});
					}
					setTimeout(initData);
				});
			}
			setTimeout(initData);
		});
	};
	init_interval = setInterval(initData, 15 * 1000);
	initData();
	update_browser_action_interval = setInterval(updateBrowserAction, 2500);
	update();
	loadFriends();
	initSavedSearches();
	getRateLimit();
	chrome.omnibox.onInputStarted.addListener(onInputStarted);
	chrome.omnibox.onInputChanged.addListener(onInputChanged);
	chrome.omnibox.onInputEntered.addListener(onInputEntered);
	if (startup && settings.current.createPopAtStartup) {
		createPopup();
	}
	startup = false;
}

function unload() {
	if (! PREFiX.loaded) return;
	clearInterval(PREFiX.interval);
	clearInterval(init_interval);
	clearInterval(update_browser_action_interval);
	PREFiX.loaded = false;
	current_id = '';
	PREFiX.account = null;
	stopStreamingAPI();
	PREFiX.current = 'tl_model';
	PREFiX.compose = {
		text: '',
		type: '',
		id: '',
		user: '',
		screen_name: ''
	};
	PREFiX.count = {
		mentions: 0,
		direct_messages: 0
	};
	PREFiX.homeTimeline = {
		tweets: [],
		buffered: [],
		scrollTop: 0,
		current: '',
		is_replying: false
	};
	PREFiX.mentions = { 
		tweets: [],
		buffered: [],
		scrollTop: 0,
		current: '',
		is_replying: false
	};
	PREFiX.directmsgs = { 
		messages: [],
		buffered: [],
		scrollTop: 0,
		current: '',
		is_replying: false
	};
	PREFiX.friends = [];
	PREFiX.keyword = '';
	stopSavedSearches();
	chrome.browserAction.setBadgeText({
		text: ''
	});
	chrome.browserAction.setTitle({
		title: 'PREFiX for Twitter'
	});
	chrome.omnibox.onInputStarted.removeListener(onInputStarted);
	chrome.omnibox.onInputChanged.removeListener(onInputChanged);
	chrome.omnibox.onInputEntered.removeListener(onInputEntered);
}

function initialize() {
	settings.load();

	initUrlExpand();

	if (PREFiX.accessToken) {
		// 更新账户信息
		updateDetails().
		next(function() {
			// 成功
			load();
		}).
		error(function(event) {
			if (event.status) {
				if (event.status === 401) {
					// access token 无效
					reset();
				} else {
					if (PREFiX.account) {
						load();
					}
					// 可能 API Hits 用光了, 延时重试
					setTimeout(initialize, 60000);
				}
			} else {
				// 网络错误
				if (PREFiX.account) {
					// 如果本地存在缓存的账户信息,
					// 则先使用缓存, 等一会再重试
					load();
					setTimeout(function() {
						updateDetails(true);
					}, 60000);
				} else {
					// 如果不存在, 则稍后再重试
					setTimeout(initialize, 60000);
				}
			}
		});

		return;
	}

	var tab_id, tab_port;
	Ripple.authorize.withPINCode(function(auth_url) {
		var options = {
			url: auth_url,
			selected: true
		};
		var deferred = Deferred();

		// 打开验证页面
		ct.create(options, function(tab) {

			ct.onUpdated.addListener(function onUpdated(id, info) {
				// 等待用户点击 '授权' 后跳转至 PIN Code 页面
				if (id !== tab.id) return;
				tab_id = id;

				// 继续验证操作
				ct.executeScript(id, {
					file: 'js/authorize.js',
					runAt: 'document_end'
				}, function() {
					// 等待页面传送 PIN Code
					var port = ct.connect(id);
					port.onMessage.addListener(function listenForPINCode(msg) {
						var pin_code = msg.pinCode;
						tab_port = port;
						// 如果页面端没有拿到 PIN Code, 会传送 'rejected' 消息过来
						deferred[pin_code == 'rejected' ? 'fail' : 'call'](pin_code);

						ct.onUpdated.removeListener(onUpdated);
						tab_port.onMessage.removeListener(listenForPINCode);
					});
				});

				ct.insertCSS(id, {
					code: '#retry { text-decoration: underline; }' +
								'#retry:hover { cursor: pointer; }'
				});
			});

		});

		// 返回 Deferred, 当拿到 PIN Code 后会继续后面的操作
		return deferred;
	}).
	next(function(token) {
		// 成功拿到 access token
		tab_port.postMessage({
			type: 'authorize',
			msg: 'success'
		});

		// 把 access token 缓存下来并重启程序
		lscache.set('access_token', token);
		PREFiX.accessToken = token;
		initialize();

		setTimeout(function() {
			closeTab(tab_id);
		}, 5000);
	}).
	error(function(error) {
		if (Ripple.getConfig('dumpLevel') > 0) {
			console.log(error);
		}
		if (tab_port) {
			// 打开了验证页面, 却没有完成验证
			tab_port.postMessage('failure');
			tab_port.onMessage.addListener(function(msg) {
				// 等待用户点击 '重试'
				if (msg.type === 'authorize' && msg.msg === 'retry') {
					closeTab(tab_id);
					initialize();
				}
			});
		} else {
			// 可能由于网络错误, 导致验证地址没有成功获取
			setTimeout(initialize, 60000);
		}
	});

}

function getPinCode() {
	var ghost_r = Ripple.createGhostRipple();
	var tab_id, tab_port;
	ghost_r.authorize.getRequestToken(sub_consumer).
	next(function(request_token) {
		request_token = Ripple.OAuth.decodeForm(request_token);
		request_token = Ripple.OAuth.getParameterMap(request_token);
		var url = R.getConstant('baseOAuthUrl') +
			'authorize?oauth_token=' +
			request_token.oauth_token +
			'&oauth_callback=oob' +
			'&appname=PREFiX';
		createTab(url);
		getSubAccessToken = function(pincode) {
			var message = {
				action: Ripple.getConstant('baseOAuthUrl') + 'access_token',
				method: 'GET',
				parameters: {
					oauth_verifier: pincode,
					oauth_token: request_token.oauth_token,
					oauth_signature_method: Ripple.getConstant('signMethod'),
					oauth_consumer_key: sub_consumer.consumer_key,
					oauth_version: Ripple.getConfig('OAuthVersion')
				}
			};
			var accessor = {
				tokenSecret: request_token.oauth_token_secret
			};
			ghost_r.authorize.sendRequest(sub_consumer, message, accessor).
			next(function(data) {
				data = Ripple.authorize.processToken(data);
				var id = +data.user_id;
				if (id !== PREFiX.account.id) return;
				lscache.set('sub_access_token', {
					oauth_token: data.oauth_token,
					oauth_token_secret: data.oauth_token_secret
				});
				ce.getViews().forEach(function(view) {
					if (view.location.href === ce.getURL('options.html')) {
						view.location.reload();
					}
				});
			});
		}
	});
}

function getSubAccessToken() { }

// 清理所有与当前用户有关的数据, 恢复到未加载状态
function reset() {
	PREFiX.unload();
	PREFiX.accessToken = PREFiX.account = null;
	lscache.remove('access_token');
	lscache.remove('sub_access_token');
	lscache.remove('account_details');
	initialize();
}

function switchTo(model_name) {
	if (! PREFiX.popupActive) {
		PREFiX.current = model_name;
	}
}

var Notifications = Notifications || webkitNotifications;
var notifications = [];

function showNotification(options) {
	var notification = Notifications.createNotification(options.icon || '/icons/40.png',
		options.title || 'PREFiX for Twitter', options.content);

	if (options.id) {
		notification.id = options.id;
		notifications = notifications.filter(function(n) {
			if (n.id != options.id)
				return true;
			n.cancel();
			return false;
		});
	}

	notification.addEventListener('close', function(e) {
		clearTimeout(notification.timeout);
		hideNotification(notification);
	}, false);

	notification.show();
	notifications.push(notification);

	if (options.timeout !== false) {
		notification.timeout = setTimeout(function() {
			hideNotification(notification);
		}, options.timeout || 30000);
	}

	return notification;
}
function hideAllNotifications() {
	notifications.slice(0).
	forEach(hideNotification);
}
function hideNotification(notification) {
	notification.cancel();
	if (notification.timeout) {
		clearTimeout(notification.timeout);
	}
	var index = notifications.indexOf(notification);
	if (index > -1) {
		notifications.splice(index, 1);
	}
}

function getStatusCount() {
	return lscache.get('status_count') || 0;
}

function getPhotoCount() {
	return lscache.get('photo_count') || 0;
}

var playSound = (function() {
	var audio = new Audio;
	audio.src = 'dongdong.mp3';
	var timeout;
	var last_played = new Date;
	last_played.setFullYear(1970);
	return function(force) {
		clearTimeout(timeout);
		if (! settings.current.playSound && ! force)
			return;
		timeout = setTimeout(function() {
			if (audio.networkState !== 1)
				return playSound();
			var now = new Date;
			if (now - last_played < 15 * 1000 && ! force)
				return;
			last_played = now;
			audio.volume = settings.current.volume;
			audio.play();
		}, 50);
	}
})();

function getLargeImage(raw){
	//Twitter Profile pic
    raw = raw.replace('_normal', '');
    raw = raw.replace('_mini', '');
	raw = raw.replace('_reasonably_small', '');
	raw = raw.replace('_bigger', '');

	//Recent Photos
	raw = raw.replace(':thumb', ''); //twimg
	raw = raw.replace('?size=t', '?size=l'); //Instagram
	raw = raw.replace('size=medium', '');

	if (/^https?:\/\/pbs\.twimg\.com\/[^\.]+\.(jpg|png)$/.test(raw)) {
		raw += ':large';
	}

	if (raw.indexOf('fotopedia.com') > -1) {
		raw = raw.replace('-image.jpg', '-hd.jpg');
	}
	
    return raw;
}

function isZoomAble(src){
    if (src.indexOf('profile_images') != -1 ||
		src.indexOf('instagr') != -1||
		src.indexOf('instagr') != -1 ||
		src.indexOf('twimg') != -1 ||
		src.indexOf('twitpic') != -1 ||
		src.indexOf('plixi') != -1 ||
		src.indexOf('twitgoo') != -1 ||
		src.indexOf('fotopedia.com') != -1) {
        return true;
    }
    return false;
}

function replaceEmoji(text) {
	text = jEmoji.softbankToUnified(text);
	text = jEmoji.googleToUnified(text);
	text = jEmoji.docomoToUnified(text);
	text = jEmoji.kddiToUnified(text);
	text = jEmoji.unifiedToHTML(text);

	return text;
}

Ripple.events.observe('process_tweet', function(tweet) {
	if (! tweet) return;
	if (tweet.user) {
		tweet.is_self = tweet.user.id_str === PREFiX.account.id_str;
	}
	var created_at = tweet.created_at;
	tweet.fullTime = (function() {
		var now = new Date;
		var local_utc_offset = now.getTimezoneOffset() * 60 * 1000;
		var user_utc_offset = tweet.user && tweet.user.utc_offset;
		if (user_utc_offset) {
			user_utc_offset *= 1000;
		} else {
			user_utc_offset = local_utc_offset;
		}
		var time = Date.parse(created_at);
		time += user_utc_offset + local_utc_offset;
		var time_zone = -user_utc_offset / 1000 / 60 / 60;
		var parsed = ('' + Math.abs(time_zone)).split('.');
		if (parsed[0].length < 2) {
			parsed[0] = '0' + parsed[0];
		}
		if (parsed[1]) {
			if (parsed[1].length < 2) {
				parsed[1] = parsed[1] + '0';
			}
		} else {
			parsed[1] = '00';
		}
		time_zone = (time_zone > 0 ? '-' : '+') + parsed.join('');
		return getFullTime(time) + ' ' + time_zone;
	})();
	tweet.relativeTime = getRelativeTime(created_at);
	tweet.shortTime = getShortTime(created_at);

	if ((tweet.is_self && ! tweet.retweeted) ||
		(tweet.user && tweet.user.protected)) {
		tweet.repostOnly = true;
	}

	tweet.current_replied = false;

	var user = tweet.user || tweet.sender;
	if (user) {
		user.profile_image_url = user.profile_image_url.replace('_normal', '');
		user.profile_image_url_https = user.profile_image_url_https.replace('_normal', '');
		var image = new Image;
		image.src = user.profile_image_url_https;

		tweet.avatar_size = {
			width: '48px',
			height: '48px'
		};
		tweet.avatar_margin = {
			left: '0',
			top: '0'
		};
		tweet.avatarProcessed = false;
		cropAvatar(tweet, image.src);
	}

	if (tweet.source) {
		tweet.source = $temp.html(tweet.source).text();
	}

	var text = tweet.text;
	tweet.textWithoutTags = text;

	if (tweet.entities) {
		var entities = [];

		var media = tweet.entities.media;
		if (media && media.length) {
			var photo = { };
			photo.url = media[0].media_url_https;
			photo.width = media[0].sizes.small.w;
			photo.height = media[0].sizes.small.h;
			processPhoto(tweet, photo);

			var media_entity = media[0];
			media_entity.type = 'url';
			entities.push(media_entity);
		}

		var urls = tweet.entities.urls;

		if (urls && urls.length) {
			urls.forEach(function(item) {
				item.type = 'url';
			});
			entities.push.apply(entities, urls);

			tweet.photo = tweet.photo || {
				url: '',
				url_large: '',
				thumbnail_url: '',
				thumb_size: {
					width: 0,
					height: 0
				},
				width: 0,
				height: 0
			};
			getOEmbed(tweet);
		}

		var hashtags = tweet.entities.hashtags;

		if (hashtags && hashtags.length) {
			hashtags.forEach(function(item) {
				item.type = 'hashtag';
			});
			entities.push.apply(entities, hashtags);
		}

		var mentions = tweet.entities.user_mentions;
		if (mentions && mentions.length) {
			mentions.forEach(function(item) {
				item.type = 'mention';
			});
			entities.push.apply(entities, mentions);
		}

		entities = entities.sort(function(a, b) {
			return a.indices[0] - b.indices[0];
		});

		var fixed_text = [];
		var new_entities = [];

		var _original_text = text;
		var _text = text.replace(jEmoji.EMOJI_ALL_RE, ' ');
		var _original_added = 0;
		var _added = 0;

		entities.unshift({
			indices: [ 0, 0 ]
		});

		entities.forEach(function(item) {
			item.original_indices = item.indices.slice();
		});

		function getStr(item) {
			var start = item.original_indices[0];
			var end = item.original_indices[1];
			return _text.slice(start - _added, end - _added);
		}

		entities.forEach(function(item, i) {
			var str = getStr(item);
			_original_text = _original_text.replace(str, '');
			_text = _text.replace(str, '');
			_original_added += str.length;
			_added += str.length;
			var next_item = entities[i + 1];
			if (next_item) {
				var mid_str = _text.slice(0, next_item.indices[0] - _added);
				var next_str = getStr(next_item);
				var next_start = _original_text.indexOf(next_str) + _original_added;
				var next_end = next_start + next_str.length;
				next_item.indices = [ next_start, next_end ];
				var mid_str_o = _original_text.slice(0, next_start - _original_added);
				_original_text = _original_text.replace(mid_str_o, '');
				_text = _text.replace(mid_str, '');
				_original_added += mid_str_o.length;
				_added += mid_str.length;
			}
		});

		entities.shift();

		if (entities.length) {
			var prefix_pos = entities[0].indices[0];
			fixed_text.push(replaceEmoji(text.slice(0, prefix_pos)));
		} else {
			fixed_text.push(replaceEmoji(text));
		}

		entities.forEach(function(entity, i) {

			var text_to_add = '';
			var start = entity.indices[0];
			var end = entity.indices[1];

			switch (entity.type) {
				case 'url':
					tweet.textWithoutTags = tweet.textWithoutTags.replace(entity.url, entity.display_url);
					text_to_add = '<a href="' + entity.expanded_url +
						'" title="' + entity.expanded_url +
						'">' + entity.display_url + '</a>';
					break;
				case 'hashtag':
					text_to_add = '<a data-hashtag="' + entity.text +
						'">#' + entity.text + '</a>';
					break;
				case 'mention':
					text_to_add = '@<a href="http://twitter.com/' +
						entity.screen_name + '" title="' + entity.name +
						' (@' + entity.screen_name + ')"  data-userid="' +
						entity.id_str + '">' +
						entity.screen_name + '</a>';
					break;
				default:
					text_to_add = text.slice(start, end);
			}

			fixed_text.push(text_to_add);

			var next_entity = entities[i + 1];
			var next_end = text.length;
			if (next_entity) {
				next_end = next_entity.indices[0];
			}
			text_to_add = text.slice(end, next_end);

			text_to_add = replaceEmoji(text_to_add);
			text_to_add = text_to_add.replace(/\n+/g, '<br />');
			fixed_text.push(text_to_add);
		});
	}

	if (tweet.in_reply_to_status_id) {
		fixed_text.push('<span class="context" title="查看上下文消息 (快捷键 C)"></span>');
	}

	text = fixed_text.join('');
	tweet.fixedText = text;

	tweet.is_breakpoint = false;
	tweet.loaded_at = null;
	tweet.loaded_at_relative = '';

	var prop_to_del = [
		'contributors',
		'coordinates',
		'favorite_count',
		'filter_level',
		'geo',
		'in_reply_to_screen_name',
		'in_reply_to_status_id',
		'in_reply_to_user_id',
		'in_reply_to_user_id_str',
		'lang',
		'place',
		'scopes',
		'retweet_count',
		'truncated',
		'possibly_sensitive',
		'withheld_copyright',
		'withheld_in_countries',
		'withheld_scope'
	];

	var user_prop_to_del = [
		'contributors_enabled',
		'default_profile',
		'default_profile_image',
		'entities',
		'favourites_count',
		'follow_request_sent',
		'geo_enabled',
		'is_translator',
		'lang',
		'listed_count',
		'notifications',
		'profile_background_color',
		'profile_background_image_url',
		'profile_background_image_url_https',
		'profile_background_tile',
		'profile_banner_url',
		'profile_link_color',
		'profile_sidebar_border_color',
		'profile_sidebar_fill_color',
		'profile_text_color',
		'profile_use_background_image',
		'show_all_inline_media',
		'time_zone',
		'url',
		'verified',
		'withheld_in_countries',
		'withheld_scope'
	];

	[
		{ obj: tweet, prop: prop_to_del },
		{ obj: tweet.user, prop: user_prop_to_del }
	].
	forEach(function(item) {
		if (item.obj) {
			item.prop.forEach(function(key) {
				delete item.obj[key];
			});
		}
	})

	if (tweet.retweeted_status) {
		arguments.callee(tweet.retweeted_status);
		tweet.photo = tweet.retweeted_status.photo;
	}

	filterOut(tweet);
});

Ripple.events.addGlobalObserver('after', function(data, e) {
	if (! e || e.type !== 'after.ajax_success')
		return;
	e = e.srcEvent;
	if (! e) return;
	if (e.url === 'https://api.twitter.com/1.1/statuses/update.json') {
		lscache.set('status_count', getStatusCount() + 1);
	} else if (e.url === 'https://api.twitter.com/1.1/statuses/update_with_media.json') {
		lscache.set('photo_count', getPhotoCount() + 1);
	}
});

if (! lscache.get('install_time')) {
	lscache.set('install_time', Date.now());
}

var is_mac = navigator.platform.indexOf('Mac') > -1;

var settings = {
	current: { },
	default: {
		playSound: true,
		smoothScroll: ! is_mac,
		autoFlushCache: false,
		cacheAmount: 75,
		zoomRatio: '1',
		drawAttention: ! is_mac,
		tweetsPerPage: 50,
		showSavedSearchCount: true,
		createPopAtStartup: false,
		volume: .75,
		holdCtrlToSubmit: false,
		embedlyKey: '',
		screenNameFirst: false,
		notification: true,
		notif_mention: true,
		notif_directmsg: true,
		notif_follower: true,
		notif_favourite: true,
		notif_retweet: true,
		repostFormat: 'RT@$name$ $text$',
		filters: [],
		flushCacheWhenTop: true
	},
	load: function() {
		var local_settings = lscache.get('settings') || { };
		var current = settings.current;
		for (var key in settings.default) {
			current[key] = local_settings[key] === undefined ?
				settings.default[key] : local_settings[key];
		}
		if (current.zoomRatio === '1.11') {
			current.zoomRatio = '1.125';
			settings.save();
		}
	},
	save: function() {
		lscache.set('settings', settings.current);
	},
	onSettingsUpdated: function() {
		initSavedSearches();
		batchProcess(function(view) {
			view.filterOutAllLists && view.filterOutAllLists();
		});
		chrome.extension.getViews().forEach(function(view) {
			if (view.location.pathname === '/popup.html' &&
				view.location.search === '?new_window=true') {
				view.location.reload();
			}
		});
	}
};

var usage_tips = [
	'按 Ctrl + Enter 或双击输入框即可发送消息. ',
	'如果您觉得字体太小, 可以在设置页启用<b>放大功能</b>. ',
	'点击 PREFiX 回到页面顶部或刷新. ',
	'如果您希望删除消息或私信, 请<b>双击</b>删除图标. ',
	'在地址栏输入 t 按空格, 然后输入内容按回车即可直接发送消息. ',
	'按 1/2/3/4 键在 首页/提到我的/私信/关注的话题 页面间切换. ',
	'右击消息中的图片, 将在后台新标签打开大图. ',
	'窗口模式运行时最小化, 当有新消息时任务栏图标会闪烁. ',
	'如果您不希望 PREFiX 播放提示音, 可以在设置页关闭. ',
	'PREFiX 页面关闭前保持滚动条在顶端可让程序性能更佳. ',
	'当输入框中字数超过 140 时, 输入框背景将显示为淡红色. ',
	'按住 Ctrl / Command 键双击输入框可以发送歌词 :)',
	'按 PageUp/PageDown 键可以快速翻页. ',
	'按 Home/End 键可以快速滑动到页面顶端/末端. ',
	'点击用户名在应用内打开个人消息页面, 点击头像打开该用户的 Twitter 个人页面. ',
	'您可以在设置页启用 Sub-Consumer 来增加可用 API 限额. ',
	'当您把鼠标放在用户名后面的 # 上时, 显示推友当地时间. ',
	'您可以在设置页开启浏览器启动时自动打开 PREFiX 窗口功能. ',
	'如果您觉得提示音音量过大, 可以在设置页调整音量. ',
	'您可以使用 Vim 风格的快捷键操作 PREFiX, 详见设置页. ',
	'您可以在扩展管理页面末端给 PREFiX 设置快捷键, 从而使用快捷键直接打开 PREFiX 页面. ',
	'如果您发现 PREFiX 启动时容易卡顿, 建议开启自动抛弃缓存功能, 并设置保留在缓存中的最大消息数量. ',
	'如果您习惯使用双击选中文本, 请在设置页中开启 "只有按住 Ctrl / Command 键才能双击输入框发送消息". ',
	'如果您希望旋转图片, 请按快捷键 R 键. ',
	'您可以自由定义转发时消息的格式, 详见设置页. ',
	'您可以在设置页中设置过滤消息的规则, 也可以按住 Shift 键右击用户头像来屏蔽 TA. '
];

var PREFiX = this.PREFiX = {
	version: chrome.app.getDetails().version,
	is_mac: is_mac,
	load: load,
	unload: unload,
	initialize: initialize,
	reset: reset,
	generateFakeId: generateFakeId,
	update: update,
	updateHomeTimeline: updateHomeTimeline,
	updateMentions: updateMentions,
	updateDirectMsgs: updateDirectMsgs,
	updateTitle: updateTitle,
	streamingAjax: null,
	getDataSince: getDataSince,
	loaded: false,
	interval: null,
	current: 'tl_model',
	keyword: '',
	compose: {
		text: '',
		type: '',
		id: '',
		user: '',
		screen_name: ''
	},
	count: {
		mentions: 0,
		direct_messages: 0
	},
	previous_count: {
		mentions: 0,
		direct_messages: 0
	},
	homeTimeline: {
		tweets: [],
		buffered: [],
		scrollTop: 0,
		current: '',
		is_replying: false
	},
	mentions: { 
		tweets: [],
		buffered: [],
		scrollTop: 0,
		current: '',
		is_replying: false
	},
	directmsgs: { 
		messages: [],
		buffered: [],
		scrollTop: 0,
		current: '',
		is_replying: false
	},
	friends: [],
	settings: settings,
	account: lscache.get('account_details'), // 当前账号的数据, 如昵称头像等
	accessToken: lscache.get('access_token'), // 缓存的 access token, 与饭否服务器联络的凭证
	user: user,
	getInstanceByRateLimit: getInstanceByRateLimit
};

initialize();
var is_first_run = lscache.get('is_first_run') !== false;
lscache.set('is_first_run', false);

setInterval(getRateLimit, 3 * 60 * 1000);

var startup = true;