'use strict';
require('harmonize')();
var through = require("through");
	
module.exports = function (options) {
    var customMocks = typeof options === 'object' && options.mocks !== undefined && typeof options.mocks === 'object' 
			? options.mocks
			: null,
		customExclude = typeof options === 'object' && options.exclude !== undefined && (typeof options.exclude === 'function' || (typeof options.exclude === 'object' && options.exclude.constructor === RegExp))
			? (typeof options.exclude === 'function' ? options.exclude : function(t) { return options.exclude.test(t); })
			: function(t) { return /^Ext\.(?!ux)/.test(t); },
		files = [],
		filesMap = {},
		clearMocks,
		defineMocks,
		onEnd,
		onFile;
	
	clearMocks = function(file) {
		var key;
		
		delete global.Ext;
		
		if (customMocks !== null) {
			for (key in customMocks) {
				delete global[key];
			}
		}
	};
	
	defineMocks = function(file, addDeclarations, addDependencies) {
		var apply = function (target, source) {
				var key;
				
				if (target === null || source === null || typeof target !== 'object' || typeof source !== 'object') {
					return;
				}
				
				for (key in source) {
					if (source.hasOwnProperty(key)) {
						if (target[key] === undefined) {
							target[key] = source[key];
						} else {
							apply(target[key], source[key]);
						}
					}
				}
			},
			getProxy = function (target, callback) {
				return Proxy.create ? Proxy.create(callback(target)) : new Proxy(target, callback(target));
			},
			ext = {
				// Mocks
				Function: {
					alias: function () {},
					bind: function () {},
					clone: function () {},
					createBuffered: function () {},
					createDelayed: function () {},
					createInterceptor: function () {},
					createSequence: function () {},
					createThrottled: function () {},
					defer: function () {},
					flexSetter: function () {},
					interceptAfter: function () {},
					interceptBefore: function () {},
					pass: function () {}
				},
				supports: {},
				Template: function () {},
				XTemplate: function () {},
				
				// Methods to handle class definitions
				
				// Ext.apply - we do not support apply
				apply: function() {
					throw new Error("Not supported");
				},
				
				// Ext.define - define class
				define: function (className, config) {
					addDeclarations(className);
					
					if (config !== null) {
						addDeclarations(config.alternateClassName);
						
						addDependencies(config.extend);
						addDependencies(config.model);
						addDependencies(config.requires);
						addDependencies(config.mixins);
					}
				},
				
				// Ext.ns - define namespace
				ns: function (ns) {
					if (typeof ns === 'string') {
						ns = [ ns ];
					}
					ns.forEach(function(c) {
						var parts = c.split('.'),
							scope = global,
							i;
							
						for (i = 0; i < parts.length; ++i) {
							if (!scope[parts[i]]) {
								scope[parts[i]] = {};
							}
							scope = scope[parts[i]];
						}
					})
				},
				
				// Ext.override - we do not support override
				override: function () {
					throw new Error("Not supported");
				},
				
				// Ext.require - add dependencies
				require: function (classes) {
					addDependencies(classes);
				},
				
				// custom namespace, no proxy here
				ux: {}
			},
			
			getNsHandler = function (target) {
				return {
					get: function (proxy, name) {
						if (!(name in target)) {
							target[name] = name.toLowerCase() === name ? getProxy({}, getNsHandler) : {};
						}
						
						return target[name];
					},
					set: function (proxy, key, value) {
						target[key] = value;
						return true;
					}
				};
			};
		
		global.Ext = getProxy(ext, getNsHandler);
		
		apply(global, customMocks);
	};
	
	onFile = function(file) {
		var declarations = [],
			dependencies = [],
			
			add = function (target, data) {
				var key;
				
				if (data === undefined || data === null) {
					return;
				}
				
				if (typeof data === 'string') {
					addOne(target, data);
					return;
				}
				
				if (typeof data.forEach === 'function') {
					data.forEach(function (item) {
						addOne(target, item);
					});
					return;
				}
				
				for (key in data) {
					if (data.hasOwnProperty(key)) {
						addOne(target, data[key]);
					}
				}
			},
			addOne = function (target, item) {
				if (typeof item === 'string' && !customExclude(item)) {
					target.push(item);
				}
			},
			addDeclarations = function (data) {
				add(declarations, data);
			},
			addDependencies = function (data) {
				add(dependencies, data);
			},
			i;
		
		try {
			defineMocks(file, addDeclarations, addDependencies);
			require(file.path);
			
			for (i = dependencies.length; i >= 0; --i) {
				if (declarations.indexOf(dependencies[i]) !== -1) {
					dependencies.splice(i, 1);
				}
			}
			
			if (!filesMap[file.path]) {
				filesMap[file.path] = true;
				files.push({
					file: file,
					declarations: declarations,
					dependencies: dependencies
				});
			}
		} catch (e) {
			throw new Error('[' + file.path + '] ' + (e.message || e));
		} finally {
			clearMocks(file);
		}
	};
	
	onEnd = function() {
		var me = this,
			defined = {},
			file,
			i,
			p,
			
			checkDependencies = function(f) {
				var dep = f.dependencies,
					i = dep.length;
					
				for (; i >= 0; --i) {
					if (defined[dep[i]]) {
						dep.splice(i, 1);
					}
				}
				return dep.length === 0;
			};

		while (files.length > 0) {
			i = 0;
			p = 0;
			while (i < files.length) {
				file = files[i];
				
				if (checkDependencies(file)) {
					file.declarations.forEach(function(c) {
						defined[c] = true;
					});
					
					files.splice(i, 1);
					
					me.emit("data", file.file);
					p++;
				} else {
					i++;
				}
			}
			
			if (p === 0) {
				var notDefined = [],
					failedFiles = [];
					console.log(files[0].relative);
				files.forEach(function(f) { 
					failedFiles.push(f.file.relative);
					f.declarations.forEach(function(c) { notDefined.push(c + ': ' + f.dependencies.join(',')); })
				});
				
				console.log(
					'Reference loop detected\r\n' + 
					'\tNot loaded files:\r\n\t\t' + failedFiles.join('\r\n\t\t') + '\r\n' +
					'\tNot defined dependencies:\r\n\t\t' + notDefined.join('\r\n\t\t')
				);
				
				throw new Error('Reference loop detected');
			}
		}
		return me.emit("end");
	};
	
	return through(onFile, onEnd);
};
