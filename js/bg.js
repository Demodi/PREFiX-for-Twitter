var ce = chrome.extension;
var ct = chrome.tabs;
var root_url = ce.getURL('');
var popup_url = ce.getURL('popup.html');

var rate_limit = {
	default: { },
	sub: { }
}

var $temp = $('<div />');

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
			url: chrome.extension.getURL('/popup.html?new_window=true')
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
			users[tweet.user.screen_name] = users[tweet.user.screen_name] || 0;

			var user = tweet.user.screen_name;

			var cont = '@' + user + getSpaces(++users[user]);

			var desc = '<dim>' + tweet.user.name + ' (@' + user + '): </dim>';
			desc += tweet.photo ? '<url>[Photo]</url> ' : '';
			desc += text + '<dim> - ';
			if (_tweet !== tweet) {
				desc += 'Retweeted by ' + _tweet.user.name + ' ';
			}
			desc += getRelativeTime(_tweet.created_at);
			desc += ' via ' + tweet.source + '</dim>';

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

function updateTitle() {
	var need_notify = false;
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
		updateTitle();
	});
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
						return t.id === new_tweet_id;
					});
					if (! new_tweet_found) {
						setTimeout(function() {
							updateHomeTimeline(--retry_chances, new_tweet_id);
						});
					}
				}
				unshift(tl.buffered, tweets);
				if (! settings.current.autoFlushCache)
					return;
				if (! PREFiX.popupActive && tl.scrollTop < 30) {
					var buffered_count = tl.buffered.length;
					var read_count = tl.tweets.length;
					var tweets_per_page = PREFiX.settings.current.tweetsPerPage;
					if (buffered_count + read_count > tweets_per_page) {
						tl.tweets.splice(Math.max(0, tweets_per_page - buffered_count));
						if (buffered_count > tweets_per_page) {
							tl.buffered.splice(tweets_per_page);
						}
					}
				}
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
			});
	}

	return deferred_dm;
}

function update() {
	var d = new Deferred;

	clearInterval(PREFiX.interval);
	PREFiX.interval = setInterval(update, 60000);

	setRefreshingState();

	var dl = [
		updateHomeTimeline(),
		updateMentions(),
		updateDirectMsgs()
	].map(function(d) {
		return d.error(function(e) {
			var prefix = 'PREFiX for Twitter - ';
			var default_error = prefix + '网络连接断开或内部错误';
			chrome.browserAction.setBadgeText({
				text: ' '
			});
			chrome.browserAction.setBadgeBackgroundColor({
				color: [ 255, 0, 0, 200 ]
			});
			chrome.browserAction.setTitle({
				title: e && e.response ?
					prefix + e.response.errors[0].message : default_error
			});
			throw e;
		});
	});

	Deferred.parallel(dl).
	hold(function() {
		if (isNeedNotify()) playSound();
	}).
	next(function() {
		updateTitle();
		d.call();
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

var init_interval;
var _initData = function() { }
function initData() {
	return _initData();
}

function load() {
	if (PREFiX.loaded) return;
	PREFiX.loaded = true;
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
				PREFiX.user().getMentions({
					count: PREFiX.settings.current.tweetsPerPage
				}).setupAjax({
					lock: initData
				}).next(function(tweets) {
					if (! PREFiX.mentions.tweets.length) {
						PREFiX.mentions.tweets = fixTweetList(tweets);
					}
					_initData = function() {
						PREFiX.user().getDirectMessages({
							count: PREFiX.settings.current.tweetsPerPage
						}).setupAjax({
							lock: initData
						}).next(function(messages) {
							if (! PREFiX.directmsgs.messages.length) {
								PREFiX.directmsgs.messages = fixTweetList(messages);
							}
							clearInterval(init_interval);
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
	PREFiX.account = null;
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
		current: ''
	};
	PREFiX.mentions = { 
		tweets: [],
		buffered: [],
		scrollTop: 0,
		current: ''
	};
	PREFiX.directmsgs = { 
		messages: [],
		buffered: [],
		scrollTop: 0,
		current: ''
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
	var notification = Notifications.createNotification(options.icon || '/icons/128.png',
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
	raw = raw.replace('?size=t', ''); //Instagram
	raw = raw.replace('size=medium', '');

	if (/^https?:\/\/pbs\.twimg\.com\/[^\.]+\.(jpg|png)$/.test(raw)) {
		raw += ':large';
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
		src.indexOf('twitgoo') != -1) {
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
		tweet.is_self = tweet.user.id === PREFiX.account.id;
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

	var user = tweet.user || tweet.sender;
	if (user) {
		user.profile_image_url = user.profile_image_url.replace('_normal', '');
		var image_http = new Image;
		image_http.src = user.profile_image_url;
		user.profile_image_url_https = user.profile_image_url_https.replace('_normal', '');
	}

	var text = tweet.text;
	tweet.textWithoutTags = text;

	if (tweet.entities) {
		var entities = [];

		var media = tweet.entities.media;
		if (media && media.length) {
			var photo = { };
			photo.url = media[0].media_url;
			var width = media[0].sizes.small.w;
			var height = media[0].sizes.small.h;
			if (width > 100 || height > 100) {
				if (width > height) {
					var k = width / 100;
					width = 100;
					height = Math.round(height / k);
				} else {
					var k = height / 100;
					height = 100;
					width = Math.round(width / k);
				}
			}
			photo.thumb_size = {
				width: width,
				height: height
			};
			photo.url_large = isZoomAble(photo.url) ?
				getLargeImage(photo.url) : photo.url;
			var img_thumb = new Image;
			img_thumb.src = photo.url;
			if (photo.url_large !== photo.url) {
				var img_large = new Image;
				img_large.src = photo.url_large;
			}
			tweet.photo = photo;

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
						' (@' + entity.screen_name + ')"">' +
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

	text = fixed_text.join('');
	tweet.fixedText = text;

	tweet.is_breakpoint = false;
	tweet.loaded_at = null;
	tweet.loaded_at_relative = '';

	if (tweet.retweeted_status) {
		arguments.callee(tweet.retweeted_status);
		tweet.photo = tweet.retweeted_status.photo;
	}
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
		smoothScroll: true,
		autoFlushCache: false,
		zoomRatio: '1',
		drawAttention: true,
		tweetsPerPage: 50,
		showSavedSearchCount: true,
		createPopAtStartup: false,
		volume: 1
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
	'在地址栏输入 t 按空格, 输入内容即可直接发送消息. ',
	'按 1/2/3/4 键在 首页/提到我的/私信/关注的话题 页面间切换. ',
	'右击消息中的图片小图, 将在新窗口打开大图. ',
	'窗口模式运行时最小化, 有新消息时任务栏图标会闪烁. ',
	'如果您不希望 PREFiX 播放提示音, 可以在设置页关闭. ',
	'本页面关闭前保持滚动条在顶端可让程序性能更佳. ',
	'当输入框中字数超过 140 时, 输入框背景显示为淡红色. ',
	'按住 Ctrl / Command 键双击输入框可以发送歌词 :)',
	'按 PageUp/PageDown 可以快速翻页. ',
	'按 Home/End 可以快速滑动到页面顶端/末端. ',
	'您可以在设置页启用 Sub-Consumer 来增加可用 API 限额. ',
	'当您把鼠标放在用户名后面的 # 上时, 显示推友当地时间. ',
	'您可以设置浏览器启动时自动打开 PREFiX 窗口. ',
	'如果您觉得提示音音量过大, 可以在设置页调整音量. ',
	'您可以使用 Vim 风格的快捷键操作 PREFiX, 详见设置页. ',
	'您可以在扩展管理页面末端给 PREFiX 设置快捷键, 从而使用快捷键直接打开 PREFiX 页面. '
];

var PREFiX = this.PREFiX = {
	version: chrome.app.getDetails().version,
	is_mac: is_mac,
	load: load,
	unload: unload,
	initialize: initialize,
	reset: reset,
	update: update,
	updateHomeTimeline: updateHomeTimeline,
	updateMentions: updateMentions,
	updateDirectMsgs: updateDirectMsgs,
	updateTitle: updateTitle,
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
		current: ''
	},
	mentions: { 
		tweets: [],
		buffered: [],
		scrollTop: 0,
		current: ''
	},
	directmsgs: { 
		messages: [],
		buffered: [],
		scrollTop: 0,
		current: ''
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