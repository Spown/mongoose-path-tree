var Mongoose = require('mongoose'),
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
Mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mongoose-path-tree');

describe('tree tests', function () {

    var userSchema = {
        name: String
    };

    var pluginOptions = {
        pathSeparator: '.',
        treeOrdering: true
    };

    if (process.env.MONGOOSE_TREE_SHORTID === '1') {
        userSchema._id = {
            type: String,
            unique: true,
            'default': function(){
                return shortId.generate();
            }
        };

        pluginOptions.idType = String;
    }

    // Schema for tests
    var UserSchema = new Schema(userSchema);
    UserSchema.plugin(Tree, pluginOptions);
    var User = Mongoose.model('User', UserSchema);

    // Set up the fixture
    beforeEach(function (done) {

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

        it('should move position', function(done) {
            User.findOne({name: 'Adam'}, function(err, adam) {
                adam.moveToPosition(1, function(err, adamWithNewPosition) {
                    should.not.exist(err);
                    adamWithNewPosition.position.should.equal(1);

                    User.findOne({name: 'Eden'}, function(err, eden) {
                        eden.position.should.equal(0);
                        done();
                    });
                });
            });
        });

        it('should update position if change parent', function(done) {
            User.findOne({name: 'Dann'}, function(err, dann) {
                User.findOne({name: 'Adam'}, function(err, adam) {
                  dann.parent = adam;
                  dann.save(function(e, d) {
                      should.not.exist(e);
                      d.position.should.equal(3);
                      done();
                  });
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

        it("should find siblings and self", function (done) {
            User.findOne({ 'name': 'Bob' }, function (err, bob) {
                if (err) { done(err); }
                bob.getSiblingsAndSelf(function (err, sibs) {
                    if (err) { done(err); }
                    should.equal(sibs.length, 3, 'should find exactly 3 documents');
                    should.equal(sibs[0].name, 'Bob', 'wrong self');
                    should.equal(sibs[1].name, 'Carol', 'wrong sibling');
                    should.equal(sibs[2].name, 'Falko', 'wrong sibling');
                    done();
                });
            });
        });

    });

    describe('move sibling position', function () {
        it("should swap siblings", function (done) {
            User.findOne({ 'name': 'Bob' }, function (err, bob) {
                if (err) { done(err); }
                bob.getSiblingsAndSelf(function (err, sibs) {
                    var initPositions = [];
                    if (err) { done(err); }
                    should.equal(sibs.length, 3, 'should find exactly 3 documents');
                    for (var idx = 0; idx < sibs.length; idx++) {
                        var doc = sibs[idx];
                        initPositions[doc.position] = doc;
                    }
                    initPositions[initPositions.length-1].moveToPosition(initPositions.length-2, function (err, doc) {
                        if (err) { done(err); }
                        should.notEqual(initPositions.length-1, doc.position, 'the meved doc\'s position didn\'t chage');
                        User.findById(initPositions[initPositions.length-2]._id, function (err, doc2) {
                            if (err) { done(err); }
                            should.notEqual(doc2.position, initPositions.length-2, 'the target doc\'s position didn\'t chage');
                            should.equal(doc2.position, initPositions.length-1, 'the target doc\'s position didn\'t chage to moved doc\'s position');
                            done();
                        });
                    });
                });
            });
        });        
    });

    describe('get children tree', function () {

        it("should return complete children tree", function (done) {

            User.getChildrenTree(function (err, childrenTree) {

                should.not.exist(err);
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
            });
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

        it("should return adam's children tree", function (done) {

            User.findOne({ 'name': 'Adam' }, function (err, adam) {

                adam.getChildrenTree(function (err, childrenTree) {

                    should.not.exist(err);

                    var bobTree = _.find(childrenTree, function(x){ return x.name == 'Bob';});

                    var carolTree = _.find(childrenTree, function(x){ return x.name == 'Carol';});
                    var danTree = _.find(carolTree.children, function(x){ return x.name == 'Dann';});
                    var emilyTree = _.find(danTree.children, function(x){ return x.name == 'Emily';});

                    bobTree.children.length.should.equal(0);
                    carolTree.children.length.should.equal(1);
                    danTree.children.length.should.equal(1);
                    danTree.children[0].name.should.equal('Emily');
                    emilyTree.children.length.should.equal(0);

                    done();
                });
            });
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

});
