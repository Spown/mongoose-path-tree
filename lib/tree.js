var streamWorker = require('stream-worker');

function escapeRegExp(string) {
    var INFINITY = 1 / 0;
  
    var symbolTag = '[object Symbol]';
  
    var reRegExpChar = /[\\^$.*+?()[\]{}|]/g,
      reHasRegExpChar = RegExp(reRegExpChar.source);
  
    var freeGlobal = typeof global === 'object' && global && global.Object === Object && global;
  
    var freeSelf = typeof self === 'object' && self && self.Object === Object && self;
  
    var root = freeGlobal || freeSelf;
  
    var objectProto = Object.prototype;
  
    var objectToString = objectProto.toString;
  
    var Symbol = root.Symbol;
  
    var symbolProto = Symbol ? Symbol.prototype : undefined,
      symbolToString = symbolProto ? symbolProto.toString : undefined;
  
    function baseToString(value) {
      if (typeof value === 'string') {
        return value;
      }
      if (isSymbol(value)) {
        return symbolToString ? symbolToString.call(value) : '';
      }
      var result = (value + '');
      return (result === '0' && (1 / value) === -INFINITY) ? '-0' : result;
    }
  
    function isObjectLike(value) {
      return !!value && typeof value === 'object';
    }
  
    function isSymbol(value) {
      /* jshint -W122 */
        return typeof value === 'symbol' ||
          (isObjectLike(value) && objectToString.call(value) === symbolTag);
      /* jshint +W122 */
    }
  
    function toString(value) {
      return ((value === null) || (value===undefined)) ? '' : baseToString(value);
    }
  
    function _escapeRegExp(string) {
      string = toString(string);
      return (string && reHasRegExpChar.test(string)) ?
        string.replace(reRegExpChar, '\\$&') :
        string;
    }
    return _escapeRegExp(string);
  }

/**
 * @class Tree
 * Tree Behavior for Mongoose
 *
 * Implements the materialized path strategy with cascade child re-parenting
 * on delete for storing a hierarchy of documents with Mongoose
 *
 * @param  {Mongoose.Schema} schema
 * @param  {Object} options
 */
function tree(schema, options) {

    var pathSeparator = options && options.pathSeparator || '#',
        wrapChildrenTree = options && options.wrapChildrenTree,
        onDelete = options && options.onDelete || 'DELETE', //'REPARENT'
        numWorkers = options && options.numWorkers || 5,
        idType = (options && options.idType) || schema.constructor.Types[schema.paths._id.instance] || schema.constructor.ObjectId,
        pathSeparatorRegex = '[' + escapeRegExp(pathSeparator) + ']',
        treeOrdering = options && options.treeOrdering || false,
            pFN = treeOrdering===true ? 'position' : String(treeOrdering) //position field name
    ;

    /**
     * Add parent and path properties
     *
     * @property {ObjectID} parent
     * @property {String} path
     */
    var properties = {
        parent: {
            type: idType,
            set: function (val) {
                return (val instanceof Object && val._id) ? val._id : val;
            },
            index: true
        },
        path: {
            type: String,
            index: true
        }
    };
    if (treeOrdering) {
        properties[pFN] = {
            type: Number
        };
    }
    schema.add(properties);

    /**
     * Pre-save middleware
     * Build or rebuild path when needed
     *
     * @param  {Function} next
     */
    schema.pre('save', function preSave(next) {
        var isParentChange = this.isModified('parent'),
            self = this, ret
        ;
        function mainAction(previousPath) {
            if (isParentChange && previousPath) {
                // When the parent is changed we must rewrite all children paths as well
                self.collection.find({ path: { '$regex': '^' + escapeRegExp(previousPath) + pathSeparatorRegex } }, function (err, cursor) {
                    if (err) { return next(err); }

                    streamWorker(
                        cursor.stream(),
                        function streamOnData(doc, done) {
                            var newPath = self.path + doc.path.substr(previousPath.length);
                            self.collection.update({ _id: doc._id }, { $set: { path: newPath } }, done);
                        },
                        {promises : false, concurrency: numWorkers},
                        next
                    );
                });
            } else {
                return next();
            }
        }

        function assignDefaultPosition(cb) {
            if (treeOrdering && self[pFN] === undefined || isParentChange) {
                return self.siblings(function(err, siblings) {
                    if (err) { return next(err); }

                    if (siblings.length > 0) {
                        self[pFN] = siblings[siblings.length - 1][pFN] + 1;
                    } else {
                        self[pFN] = 0;
                    }
                    return cb();
                });
            } else {
                return cb();
            }
        }

        if (this.isNew || isParentChange) {
            if (!this.parent) {
                var previousPath = this.path;
                this.path = this._id.toString();
                ret = assignDefaultPosition(function(){
                    mainAction(previousPath);
                });
            } else {
                this.collection.findOne({ _id: this.parent }, function (err, doc) {
                    if (err) { return next(err); }
    
                    var previousPath = self.path;
                    self.path = doc.path + pathSeparator + self._id.toString();
                    ret = assignDefaultPosition(function(){
                        mainAction(previousPath);
                    });
                });
            }
        } else {
            ret = assignDefaultPosition(next);
        }
        return ret;
    });

    /**
     * Pre-remove middleware
     *
     * @param  {Function} next
     */
    schema.pre('remove', function preRemove(next) {

        if (!this.path)
            return next();

        if (onDelete === 'DELETE' && this.path) {
            this.collection.remove({ path: { '$regex': '^' + escapeRegExp(this.path) + pathSeparatorRegex } }, next);
        }
        else {
            var self = this,
                newParent = this.parent,
                previousParent = this._id;

            // Update parent property from children
            this.collection.find({ parent: previousParent }, function (err, cursor) {

                if (err) {
                    return next(err);
                }

                streamWorker(
                    cursor.stream(),
                    function(doc, done) {

                        self.collection.update({ _id: doc._id }, { $set: { parent: newParent } }, done);
                    },
                    {promises : false, concurrency: numWorkers},
                    function(err) {
                        if (err) { return next(err); }

                        if (previousParent) {
                            self.collection.find({
                                path: { $regex: escapeRegExp(previousParent) + pathSeparatorRegex }
                            }, function (err, cursor) {
                                if (err) { return next(err); }
                                var subStream = cursor.stream();
                                streamWorker(
                                    subStream,
                                    function (doc, done) {
                                        var newPath = doc.path.replace(previousParent + pathSeparator, '');
                                        self.collection.update({
                                            _id: doc._id
                                        }, {
                                            $set: {
                                                path: newPath
                                            }
                                        }, done);
                                    }, {
                                        promises: false,
                                        concurrency: numWorkers
                                    },
                                    next
                                );
                            });
                        }
                    }
                );
            });
        }
    });


    /**
     * @method getChildren
     *
     * @param  {Object}        filters (like for mongo find) (optional)
     * @param  {Object|String} fields  (like for mongo find) (optional)
     * @param  {Object}        options (like for mongo find) (optional)
     * @param  {Boolean}       recursive, default false      (optional)
     * @param  {Function}      next
     * @return {Model}
     */
    schema.methods.getChildren = function getChildren(filters, fields, options, recursive, next) {

        // normalize the arguments
        if ('function' === typeof filters) {
            next = filters;
            filters = {};
        }
        else if ('function' === typeof fields) {
            next = fields;
            fields = null;

            if ('boolean' === typeof filters) {
                recursive = filters;
                filters = {};
            }
        }
        else if ('function' === typeof options) {
            next = options;
            options = {};

            if ('boolean' === typeof fields) {
                recursive = fields;
                fields = null;
            }
        }
        else if ('function' === typeof recursive) {
            next = recursive;

            if ('boolean' === typeof options) {
                recursive = options;
                options = {};
            }
            else {
                recursive = false;
            }
        }

        filters = filters || {};
        fields = fields || null;
        options = options || {};
        recursive = recursive || false;

        if (recursive && this.path) {
            if(filters.$query){
                filters.$query.path = {$regex: '^' + escapeRegExp(this.path) + pathSeparatorRegex};
            } else {
                filters.path = {$regex: '^' + escapeRegExp(this.path) + pathSeparatorRegex};
            }
        } else {
            if(filters.$query){
                filters.$query.parent = this._id;
            } else {
                filters.parent = this._id;
            }
        }

        return this.model(this.constructor.modelName).find(filters, fields, options, next);
    };


    /**
     * @method getParent
     *
     * @param  {Function} next
     * @return {Model}
     */
    schema.methods.getParent = function getParent(next) {

        return this.model(this.constructor.modelName).findOne({ _id: this.parent }, next);
    };


    /**
     * @method getAncestors
     *
     * @param  {Object}   args
     * @param  {Function} next
     * @return {Model}
     */
    schema.methods.getAncestors = function getAncestors(filters, fields, options, next) {

        if ('function' === typeof filters) {
            next = filters;
            filters = {};
        }
        else if ('function' === typeof fields) {
            next = fields;
            fields = null;
        }
        else if ('function' === typeof options) {
            next = options;
            options = {};
        }

        filters = filters || {};
        fields = fields || null;
        options = options || {};

        var ids = [];

        if (this.path) {
            ids = this.path.split(pathSeparator);
            ids.pop();
        }

        if(filters.$query){
            filters.$query._id = {$in: ids};
        } else {
            filters._id = {$in: ids};
        }

        return this.model(this.constructor.modelName).find(filters, fields, options, next);
    };

    function findChildrenByParent(arr, parent, params) {
        var parentId = parent ? parent._id.toString() : undefined;
        var nodes = [];
        arr.forEach(function (node) {
            var nodeParentId = node.parent ? node.parent.toString() : undefined;
            if (nodeParentId === parentId) {
                if (params.objectify && node.toObject) {
                    node = node.toObject(typeof params.objectify === 'object' ? params.objectify : {});
                }
                nodes.push(node);
            }
        });
        return nodes;
    }
    function createChildrenTree(arr, node, params) {
        var nodes = findChildrenByParent(arr, node, params);
        if (nodes.length > 0) {
            nodes.forEach(function (n) {
                var children = createChildrenTree(arr, n, params);
                if (children.length > 0 || (children.length === 0 && params.allowEmptyChildren)) {
                    n.children = children;
                }
            });
        }
        return nodes;
    }
    function getLevel(path) {
        return path ? path.split(pathSeparator).length : 0;
    }

    /**
     * @method getChildrenTree
     *
     * @param  {Document} root (optional)
     * @param  {Object}   args (optional)
     *         {Object}        .filters (like for mongo find)
     *  {Object} or {String}   .fields  (like for mongo find)
     *         {Object}        .options (like for mongo find)
     *  {Object} or {String}   .populate (like for mongo populate-performed after find)
     *         {Number}        .minLevel, default 1
     *         {Boolean}       .recursive
     *         {Boolean}       .allowEmptyChildren
     * @param  {Function} next
     * @return {Model}
     */
    schema.statics.getChildrenTree = function getChildrenTree() { //root, args, next
        var a= arguments, l = a.length,
            _args = (arguments.length === 1 ? [arguments[0]] : Array.apply(null, arguments)),
            next, root, args = {}
        ;
        _args.forEach(function(_arg) {
            if ("function" === typeof _arg) {
                next = _arg;
            } else if ('object' === typeof _arg && ("model" in _arg)) {
                root = _arg;
            } else if ('object' === typeof _arg) {
                args = _arg;
            }            
        }, this);

        var filters = args.filters || {},
            fields = args.fields || null,
            options = args.options || {},
            minLevel = args.minLevel || 1,
            recursive = args.recursive !== undefined ? args.recursive : true,
            allowEmptyChildren = args.allowEmptyChildren !== undefined ? args.allowEmptyChildren : true,
            objectify = args.objectify || false,
            populationQuery = args.populate || '',
            _params = {
                objectify: objectify,
                allowEmptyChildren: allowEmptyChildren
            }
        ;

        // filters: Add recursive path filter or not
        if (recursive) {
            if (root && root.path) {
                filters.path = { $regex: '^' + escapeRegExp(root.path) + pathSeparatorRegex };
            }

            if (filters.parent === null) {
                delete filters.parent;
            }

        } else {
            if (root) {
                filters.parent = root._id;
            }
            else {
                filters.parent = null;
            }
        }

        // fields: Add path, parent and position in the result if not already specified
        if (fields) {
            if (fields instanceof Object) {
                if (!fields.hasOwnProperty('path')) {
                    fields.path = 1;
                }
                if (!fields.hasOwnProperty('parent')) {
                    fields.parent = 1;
                }
                if (!fields.hasOwnProperty(pFN) && treeOrdering) {
                    fields[pFN] = 1;
                }
            }
            else {
                if (!fields.match(/path/)) {
                    fields += ' path';
                }
                if (!fields.match(/parent/)) {
                    fields += ' parent';
                }
                if (!fields.match(RegExp('/'+escapeRegExp(pFN)+'/')) && treeOrdering) {
                    fields += ' '+pFN;
                }
            }
        }

        // options:sort
        if (!options.sort) {
            options.sort = {};
            // if enable treeOrdering option and not specific a sort option, sort by position ASC is default
            if (treeOrdering) {
                options.sort[pFN] = 1;
            }
        }

        if (!options.lean) {
            options.lean = !wrapChildrenTree;
        }

        return this.find(filters, fields, options)
            .populate(populationQuery)
            .then(function (results) {
                var finalResults = [],
                    rootLevel = 1
                ;
                if (root) {
                    rootLevel = getLevel(root.path) + 1;
                }
                if (minLevel < rootLevel) {
                    minLevel = rootLevel;
                }
                finalResults = createChildrenTree(results, root, _params);

                if (next) {
                    next(null, finalResults);
                    return;
                } else {
                    return finalResults;
                }
            }, function (err) {
                if (next) {
                    next(err);
                    return;
                } else {
                    throw err;
                }
            }
        );
    };


    schema.methods.getChildrenTree = function(args, next) {
        return this.constructor.getChildrenTree(this, args, next);
    };

    /**
     * Returns this document's siblings and itself
     * @method siblingsAndSelf
     *
     * @param  {Function} next
     * @return [Model]
     */
    schema.methods.siblingsAndSelf = 
    schema.methods.getSiblingsAndSelf = function(next) {
        var query = this.model(this.constructor.modelName).find({parent: this.parent}), opts = {}
        ;
        opts[pFN] = 1;
        if (treeOrdering) {
            query = query.sort(opts);
        }
        return query.exec(next);
    };

    /**
     * Returns this document's siblings
     * @method siblings
     *
     * @param  {Function} next
     * @return [Model]
     */
    schema.methods.siblings = 
    schema.methods.getSiblings = function(next) {
        var query = this.model(this.constructor.modelName)
            .find({_id: {$ne: this._id}, parent: this.parent}),
            opts = {}
        ;
        opts[pFN] = 1;
        if (treeOrdering) {
            query = query.sort(opts);
        }
        return query.exec(next);
    };

    /**
     * Move this node to the specified position on same level
     * @method moveToPosition
     *
     * @param  {Function} next
     * @return [Model]
     */
    schema.methods.moveToPosition = function(newPosition, next) {
        var self = this,
            query = self.model(self.constructor.modelName).where({ parent: self.parent }),
            options = { multi: true },
            posDir = -1, whereOpts = {}, updOpts = {}
        ;
        //(new mongoose.Query()).
        return query.count()
        .then(function (count) {
            var query2, _err;
            if (!treeOrdering) {
                _err = new Error('"treeOrdering" option must be set in order to use .moveToPosition()');
                if (!next) {
                    throw _err;
                } else {
                    next(_err);
                    return undefined;
                }
            } else if (newPosition === self[pFN]) {
                if (!next) {
                    return self;                    
                } else {
                    next(null, self);
                    return;
                }
            } else {
                newPosition = newPosition >= count ? count-1 : newPosition;
                if (newPosition > self[pFN]) {
                    whereOpts[pFN] = { $gt: self[pFN], $lte: newPosition };
                    query2 = query.where(whereOpts);
                } else {
                    whereOpts[pFN] = { $gte: newPosition, $lt: self[pFN] };
                    query2 = query.where(whereOpts);
                    posDir = 1;
                }
                updOpts[pFN] = posDir;
                return query2
                .setOptions(options)
                .update({ $inc: updOpts })
                .then(function () {
                    self[pFN] = newPosition;
                    return self.save();              
                })
                .then(function (doc) {
                    if (!next) {
                        return doc;                    
                    } else {
                        next(null, doc);
                        return;
                    }
                })
                ;
            }
        })
        ;
    };

    /**
     * @property {Number} level <virtual>
     */
    schema.virtual('level').get(function virtualPropLevel() {

        return this.path ? this.path.split(pathSeparator).length : 0;
    });
}

module.exports = exports = tree;
