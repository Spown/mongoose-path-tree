var Mongoose = require('mongoose'),
        conn,
    Tree = require('../lib/tree'),
    Async = require('async'),
    should = require('should'),
    _ = require('lodash'),
    shortId = require('shortid'),
    Schema = Mongoose.Schema
;
if ('undefined' !== typeof Promise) {
    Mongoose.Promise = Promise;
} 


describe('tree tests', function () {
    this.timeout(5000);
    var UserSchema, User,
        userSchemaConfig = {
            name: String
        },
        pFN,
        pluginOptions = {
            pathSeparator: '.',
            treeOrdering: (pFN='_position')
        }
    ;

    if (process.env.MONGOOSE_TREE_SHORTID === '1') {
        userSchemaConfig._id = {
            type: String,
            unique: true,
            'default': function(){
                return shortId.generate();
            }
        };

        pluginOptions.idType = String;
    }

    // Set up the fixture
    var prepares = {
        _std: {
            userSchemaConfig: userSchemaConfig,
            pluginOptions: pluginOptions,
            before: function (done) {
                User.remove({}, function (err) {

                    should.not.exist(err);

                    var adam = new User({name: 'Adam' }),
                            bob = new User({name: 'Bob', parent: adam }),
                            carol = new User({name: 'Carol', parent: adam }),
                                dann = new User({name: 'Dann', parent: carol }),
                                    emily = new User({name: 'Emily', parent: dann }),
                            falko = new User({name: 'Falko', parent: adam }),
                        eden = new User({name: 'Eden' })
                    ;
                    Async.forEachSeries([adam, bob, carol, falko, dann, emily, eden], function (doc, cb) {
                        doc.save(cb);
                    }, done);
                });
            }
        },
        'should return an error if "treeOrdering" isn\'t set': {
            pluginOptions: {}
        },
        'should return an error if "treeOrdering" isn\'t set (promise)': {
            pluginOptions: {}
        },
        'should reparent children': {
            pluginOptions: {
                onDelete: 'REPARENT'
            }
        }
    };

    function mConnect(prepare, stdPrepare, done) {
        conn = Mongoose.createConnection(process.env.MONGODB_URI || 'mongodb://localhost:27017/mongoose-path-tree');
        conn
        .on('error', done)
        .on('connected', function() {
            UserSchema = new Schema(prepare.userSchemaConfig || stdPrepare.userSchemaConfig);
            UserSchema.plugin(Tree, prepare.pluginOptions || stdPrepare.pluginOptions);
            User = conn.model('User', UserSchema);
            (prepare.before || stdPrepare.before)(done);
        });
    }
    function prepareForTest(name, done) {
        var stdPrepare = prepares._std,
            prepare = (prepares[name] || stdPrepare)
        ;
        if (conn) {
            _conn = conn.close(function () {
                mConnect(prepare, stdPrepare, done);
            });
        } else {
            mConnect(prepare, stdPrepare, done);
        }

    }

    beforeEach(function (done) {
        prepareForTest(this.currentTest.title, done);
    });


    describe('adding documents', function () {

        it('should set parent id and path', function (done) {

            User.find({}, function (err, users) {

                should.not.exist(err);

                var names = {};
                users.forEach(function (user) {

                    names[user.name] = user;
                });

                should.not.exist(names['Adam'].parent);
                names['Bob'].parent.toString().should.equal(names['Adam']._id.toString());
                names['Carol'].parent.toString().should.equal(names['Adam']._id.toString());
                names['Dann'].parent.toString().should.equal(names['Carol']._id.toString());
                names['Emily'].parent.toString().should.equal(names['Dann']._id.toString());

                var expectedPath = [names['Adam']._id, names['Carol']._id, names['Dann']._id].join('.');
                names['Dann'].path.should.equal(expectedPath);

                done();
            });
        });
    });


    describe('removing document', function () {

        it('should remove leaf nodes', function (done) {

            User.findOne({ name: 'Emily' }, function (err, emily) {

                emily.remove(function (err) {

                    should.not.exist(err);

                    User.find(function (err, users) {

                        should.not.exist(err);
                        users.length.should.equal(6);
                        _.map(users, 'name').should.not.containEql('Emily');
                        done();
                    });
                });
            });
        });

        it('should remove all children', function (done) {

            User.findOne({ name: 'Carol' }, function (err, user) {

                should.not.exist(err);

                user.remove(function (err) {

                    should.not.exist(err);

                    User.find(function (err, users) {

                        should.not.exist(err);

                        users.length.should.equal(4);
                        _.map(users, 'name').should.containEql('Adam').and.containEql('Bob');
                        done();
                    });
                });
            });
        });

        it('should reparent children', function (done) {
            var dansOldParent, carolsParent;
            User.findOne({ name: 'Dann' }, function (err, dann) {
                should.not.exist(err);
                dansOldParent = dann.parent;
                User.findOne({ name: 'Carol' }, function (err, carol) {
                    should.not.exist(err);
                    carolsParent = carol.parent;
                    carol.remove(function (err) {
                        should.not.exist(err);
                        User.find(function (err, users) {
                            should.not.exist(err);
                            users.length.should.equal(6);
                            should.equal( _.find(users, {name: 'Dann'}).parent.toString(), carolsParent.toString());
                            done();
                        });
                    });
                });
            }); 
        });

    });


    function checkPaths(done) {
        User.find({}, function (err, users) {

            should.not.exist(err);

            var ids = {};
            users.forEach(function (user) {

                ids[user._id] = user;
            });

            users.forEach(function (user) {

                if (!user.parent) {
                    return;
                }
                should.exist(ids[user.parent]);
                user.path.should.equal(ids[user.parent].path + "." + user._id);
            });

            done();
        });
    }

    describe('moving documents', function () {

        it('should change children paths', function (done) {

            User.find({}, function (err, users) {
                should.not.exist(err);

                var names = {};
                users.forEach(function (user) {

                    names[user.name] = user;
                });

                var carol = names['Carol'];
                var bob = names['Bob'];

                carol.parent = bob;
                carol.save(function (err) {

                    should.not.exist(err);
                    checkPaths(done);
                });
            });
        });

    });


    describe('get children', function () {

        it('should return immediate children with filters', function (done) {

            User.findOne({name: 'Adam'}, function (err, adam) {

                should.not.exist(err);
                adam.getChildren({name: 'Bob'}, function (err, users) {

                    should.not.exist(err);
                    users.length.should.equal(1);
                    _.map(users, 'name').should.containEql('Bob');
                    done();
                });
            });
        });

        it('should return immediate children', function (done) {

            User.findOne({name: 'Adam'}, function (err, adam) {

                should.not.exist(err);

                adam.getChildren(function (err, users) {

                    should.not.exist(err);

                    users.length.should.equal(3);
                    _.map(users, 'name').should.containEql('Bob').and.containEql('Carol');
                    done();
                });
            });
        });

        it('should return recursive children', function (done) {

            User.findOne({ 'name': 'Carol' }, function (err, carol) {

                should.not.exist(err);

                carol.getChildren(true, function (err, users) {

                    should.not.exist(err);

                    users.length.should.equal(2);
                    _.map(users, 'name').should.containEql('Dann').and.containEql('Emily');
                    done();
                });
            });
        });

        it('should return children with only name and _id fields', function (done) {

            User.findOne({ 'name': 'Carol' }, function (err, carol) {

                should.not.exist(err);

                carol.getChildren({}, 'name', true, function (err, users) {

                    should.not.exist(err);

                    users.length.should.equal(2);
                    should.not.exist(users[0].parent);
                    _.map(users, 'name').should.containEql('Dann').and.containEql('Emily');
                    done();
                });
            });
        });

        it('should return children sorted on name', function (done) {

            User.findOne({ 'name': 'Carol' }, function (err, carol) {

                should.not.exist(err);

                carol.getChildren({}, null, {sort: {name: -1}}, true, function (err, users) {

                    should.not.exist(err);

                    users.length.should.equal(2);
                    users[0].name.should.equal('Emily');
                    _.map(users, 'name').should.containEql('Dann').and.containEql('Emily');
                    done();
                });
            });
        });
    });


    describe('level virtual', function () {

        it('should equal the number of ancestors', function (done) {

            User.findOne({ 'name': 'Dann' }, function (err, dann) {

                should.not.exist(err);

                dann.level.should.equal(3);
                done();
            });
        });
    });


    describe('get ancestors', function () {

        it('should return immidiate parent', function (done) {
            User.findOne({ 'name': 'Dann' }, function (err, dann) {
                dann.getParent(function (err, parent) {
                    should.not.exist(err);
                    parent.name.should.equal('Carol');
                    done();
                });
            });            
        });

        it('should return immidiate parent (promise)', function () {
            return User.findOne({ 'name': 'Dann' })
            .then(function (dann) {
                return dann.getParent();
            })
            .then(function (parent) {
                parent.name.should.equal('Carol');
            });           
        });

        it('should return ancestors', function (done) {
            User.findOne({ 'name': 'Dann' }, function (err, dann) {

                dann.getAncestors(function (err, ancestors) {

                    should.not.exist(err);
                    ancestors.length.should.equal(2);
                    _.map(ancestors, 'name').should.containEql('Carol').and.containEql('Adam');
                    done();
                });
            });
        });

        it('should return ancestors with only name and _id fields', function (done) {

            User.findOne({ 'name': 'Dann' }, function (err, dann) {

                dann.getAncestors({}, 'name', function (err, ancestors) {
                    should.not.exist(err);

                    ancestors.length.should.equal(2);
                    should.not.exist(ancestors[0].parent);
                    ancestors[0].should.have.property('name');
                    _.map(ancestors, 'name').should.containEql('Carol').and.containEql('Adam');
                    done();
                });
            });
        });

        it('should return ancestors sorted on name and without wrappers', function (done) {

            User.findOne({ 'name': 'Dann' }, function (err, dann) {

                dann.getAncestors({}, null, {sort: {name: -1}, lean: 1}, function (err, ancestors) {
                    should.not.exist(err);

                    ancestors.length.should.equal(2);
                    ancestors[0].name.should.equal('Carol');
                    should.not.exist(ancestors[0].getAncestors);
                    _.map(ancestors, 'name').should.containEql('Carol').and.containEql('Adam');
                    done();
                });
            });
        });
    });

    describe('get siblings', function () {

        it("should find siblings", function (done) {
            User.findOne({ 'name': 'Bob' }, function (err, bob) {
                if (err) { done(err); }
                bob.getSiblings(function (err, sibs) {
                    if (err) { done(err); }
                    should.equal(sibs.length, 2, 'should find exactly 2 sibling document');
                    should.equal(sibs[0].name, 'Carol', 'wrong sibling');
                    should.equal(sibs[1].name, 'Falko', 'wrong sibling');
                    done();
                });
            });
        });

        it("should find siblings (promise)", function () {
            return User.findOne({ 'name': 'Bob' })
            .then(function (bob) {
                return bob.getSiblings();
            })
            .then(function (sibs) {
                should.equal(sibs.length, 2, 'should find exactly 2 sibling document');
                should.equal(sibs[0].name, 'Carol', 'wrong sibling');
                should.equal(sibs[1].name, 'Falko', 'wrong sibling');
            })
            ;
        });

        it("should find siblings and self", function (done) {
            User.findOne({ 'name': 'Bob' }, function (err, bob) {
                if (err) { done(err); }
                bob.getSiblingsAndSelf(function (err, sibs) {
                    if (err) { done(err); }
                    should.equal(sibs.length, 3, 'should find exactly 3 documents');
                    sibs.should.matchEach(function(doc) { doc.name.should.match(/^(Bob|Carol|Falko)$/); });
                    done();
                });
            });
        });

    });

    describe('move sibling position', function () {

        it('should return an error if "treeOrdering" isn\'t set', function (done) {
            var a = User.findOne({ 'name': 'Bob' }, function (err, bob) {
                bob.moveToPosition(0, function (err, bob) {
                    err.should.be.an.Error();
                    err.message.should.equal("\"treeOrdering\" option must be set in order to use .moveToPosition()");
                    done();
                });
            });
        });

        it('should return an error if "treeOrdering" isn\'t set (promise)', function (done) {
            User
            .findOne({ 'name': 'Bob' })
            .then(function (bob) {
                var prom = bob.moveToPosition(0);
                prom.should.be.a.Promise();
                return prom;
            })
            .then(function (bob) {
                done('calls success instead of a fail');
            }, function (err) {
                err.should.be.an.Error();
                err.message.should.equal("\"treeOrdering\" option must be set in order to use .moveToPosition()");
                done();
            })
            ;
        });

        it("should swap siblings", function (done) {
            User.findOne({ 'name': 'Bob' }, function (err, bob) {
                if (err) { done(err); }
                bob.getSiblingsAndSelf(function (err, sibs) {
                    var initPositions = [];
                    if (err) { done(err); }
                    should.equal(sibs.length, 3, 'should find exactly 3 documents');
                    for (var idx = 0; idx < sibs.length; idx++) {
                        var doc = sibs[idx];
                        initPositions[doc[pFN]] = doc;
                    }
                    if (initPositions.length) {
                        initPositions[initPositions.length-1].moveToPosition(initPositions.length-2, function (err, doc) {
                            if (err) { done(err); }
                            should.notEqual(initPositions.length-1, doc[pFN], 'the meved doc\'s position didn\'t chage');
                            User.findById(initPositions[initPositions.length-2]._id, function (err, doc2) {
                                if (err) { done(err); }
                                should.notEqual(doc2[pFN], initPositions.length-2, 'the target doc\'s position didn\'t chage');
                                should.equal(doc2[pFN], initPositions.length-1, 'the target doc\'s position didn\'t chage to moved doc\'s position');
                                done();
                            });
                        });
                    } else {
                        done('initPositions is empty');
                    }
                });
            });
        });

        it("should swap siblings (promise)", function () {
            var initPositions = [];
            return User.findOne({ 'name': 'Bob' })
            .then(function (bob) {
                return bob.getSiblingsAndSelf();
            })
            .then(function (sibs) {
                should.equal(sibs.length, 3, 'should find exactly 3 documents');
                for (var idx = 0; idx < sibs.length; idx++) {
                    var doc = sibs[idx];
                    initPositions[doc[pFN]] = doc;
                }
                return initPositions[initPositions.length-1].moveToPosition(initPositions.length-2);
            })
            .then(function (doc) {
                should.notEqual(initPositions.length-1, doc[pFN], 'the meved doc\'s position didn\'t chage');
                return User.findById(initPositions[initPositions.length-2]._id);
            })
            .then(function (doc2) {
                should.notEqual(doc2[pFN], initPositions.length-2, 'the target doc\'s position didn\'t chage');
                should.equal(doc2[pFN], initPositions.length-1, 'the target doc\'s position didn\'t chage to moved doc\'s position');
            })
            ;
        });

        it('should move a sibling to the last vacant position and not further (promise)', function (done) {
            var count = 0;
            User
            .findOne({name: 'Adam'})
            .then(function (adam) {
                return User.count({parent: adam._id});
            })
            .then(function (_count) {
                var q = {};
                count = _count;
                q[pFN] = count-2; //prelast
                return User.findOne(q);
            })
            .then(function (doc) {
                return doc.moveToPosition(100500);
            })
            .then(function (doc) {
                doc[pFN].should.equal(count-1);
                done();
            })
            .catch(done);
        });

        it('should not move if the position remains the same', function (done) {
            var oldPos;
            User.findOne({ 'name': 'Bob' }, function (err, bob) {
                should.not.exist(err);
                bob.moveToPosition(oldPos=bob[pFN], function (err, bob) {
                    should.not.exist(err);
                    bob[pFN].should.equal(oldPos);
                    done();
                });
            });
        });

        it('should not move if the position remains the same (promise)', function () {
            var oldPos;
            return User.findOne({ 'name': 'Bob' })
            .then(function (bob) {
                return bob.moveToPosition(oldPos=bob[pFN]);
            })
            .then(function (bob) {
                bob[pFN].should.equal(oldPos);
            });
        });
    });

    describe('get children tree', function () {

        function checkTree(childrenTree, done) {

            childrenTree.length.should.equal(2);

            var adamTree = _.find(childrenTree, function(x){ return x.name == 'Adam';});
            var edenTree = _.find(childrenTree, function(x){ return x.name == 'Eden';});

            var bobTree = _.find(adamTree.children, function(x){ return x.name == 'Bob';});

            var carolTree = _.find(adamTree.children, function(x){ return x.name == 'Carol';});
            var danTree = _.find(carolTree.children, function(x){ return x.name == 'Dann';});
            var emilyTree = _.find(danTree.children, function(x){ return x.name == 'Emily';});


            adamTree.children.length.should.equal(3);
            edenTree.children.length.should.equal(0);

            bobTree.children.length.should.equal(0);

            carolTree.children.length.should.equal(1);

            danTree.children.length.should.equal(1);
            danTree.children[0].name.should.equal('Emily');

            emilyTree.children.length.should.equal(0);
            done();
        }
        it("should return complete children tree", function (done) {

            User.getChildrenTree(function (err, childrenTree) {
                should.not.exist(err);
                checkTree(childrenTree, done);
            });
        });

        it("should return complete children tree (promise)", function (done) {

            User
            .getChildrenTree()
            .then(function (childrenTree) {
                checkTree(childrenTree, done);
            })
            .catch(done)
            ;
        });

        it("should return complete children tree sorted on name", function (done) {

            User.getChildrenTree({options: {sort: {name: -1}}}, function (err, childrenTree) {

                should.not.exist(err);
                childrenTree.length.should.equal(2);

                childrenTree[0].name.should.equal('Eden');
                _.map(childrenTree, 'name').should.containEql('Adam').and.containEql('Eden');

                var adamTree = _.find(childrenTree, function(x){ return x.name == 'Adam';});

                adamTree.children.length.should.equal(3);
                adamTree.children[0].name.should.equal('Falko');
                _.map(adamTree.children, 'name').should.containEql('Bob').and.containEql('Carol');

                done();
            });
        });

        function adamsChildrenTree(childrenTree, done) {
            var bobTree = _.find(childrenTree, function (x) { return x.name == 'Bob'; });

            var carolTree = _.find(childrenTree, function (x) { return x.name == 'Carol'; });
            var danTree = _.find(carolTree.children, function (x) { return x.name == 'Dann'; });
            var emilyTree = _.find(danTree.children, function (x) { return x.name == 'Emily'; });

            bobTree.children.length.should.equal(0);
            carolTree.children.length.should.equal(1);
            danTree.children.length.should.equal(1);
            danTree.children[0].name.should.equal('Emily');
            emilyTree.children.length.should.equal(0);

            done();
        }
        it("should return adam's children tree", function (done) {
            User.findOne({ 'name': 'Adam' }, function (err, adam) {
                adam.getChildrenTree(function (err, childrenTree) {
                    should.not.exist(err);
                    adamsChildrenTree(childrenTree, done);
                });
            });
        });
        it("should return adam's children tree (promise)", function (done) {
            User.findOne({ 'name': 'Adam' })
            .then(function (adam) {
                return adam.getChildrenTree();
            })
            .then(function (childrenTree) {
                adamsChildrenTree(childrenTree, done);
            })
            .catch(done)
            ;
        });
        it("should ignore exclusion of tree paths through object (promise)", function (done) {
            User.findOne({ 'name': 'Adam' })
            .then(function (adam) {
                var fields = {path: 0, parent: 0, name: 1 };
                fields[pFN] = 0;
                return adam.getChildrenTree({fields: fields});
            })
            .then(function (childrenTree) {
                var doc = childrenTree[0];
                doc.should.properties(['path', 'parent', pFN]);
                done();
            })
            .catch(done)
            ;
        });
        it("should ignore non-clusion of tree paths through object (promise)", function (done) {
            User.findOne({ 'name': 'Adam' })
            .then(function (adam) {
                return adam.getChildrenTree({fields: {name: 1}});
            })
            .then(function (childrenTree) {
                var doc = childrenTree[0];
                doc.should.properties(['path', 'parent', pFN]);
                done();
            })
            .catch(done)
            ;
        });
        it("should ignore exclusion of tree paths through string (promise)", function (done) {
            User.findOne({ 'name': 'Adam' })
            .then(function (adam) {
                return adam.getChildrenTree({fields: '+name -path -parent -'+pFN});
            })
            .then(function (childrenTree) {
                var doc = childrenTree[0];
                doc.should.properties(['path', 'parent', pFN]);
                done();
            })
            .catch(done)
            ;
        });
        it("should ignore non-inclusion of tree paths through string (promise)", function (done) {
            User.findOne({ 'name': 'Adam' })
            .then(function (adam) {
                return adam.getChildrenTree({fields: '+name'});
            })
            .then(function (childrenTree) {
                var doc = childrenTree[0];
                doc.should.properties(['path', 'parent', pFN]);
                done();
            })
            .catch(done)
            ;
        });

        it("should return adam's complete children tree sorted on name", function (done) {
            User.findOne({ 'name': 'Adam' }, function (err, adam) {

                adam.getChildrenTree({allowEmptyChildren: false, options: {sort: {name: -1}}}, function (err, childrenTree) {

                    should.not.exist(err);

                    childrenTree.length.should.equal(3);
                    childrenTree[0].name.should.equal('Falko');
                    _.map(childrenTree, 'name').should.containEql('Bob').and.containEql('Carol');

                    done();
                });
            });
        });

    });

    after('ending', function (done) {
        conn.close(function () {
            done();
        });
    });
});
