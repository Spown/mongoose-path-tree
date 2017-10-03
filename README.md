## mongoose-path-tree
[![Build Status](https://travis-ci.org/Spown/mongoose-path-tree.svg?branch=master)](https://travis-ci.org/Spown/mongoose-path-tree)

[![Code Climate](https://codeclimate.com/github/Spown/mongoose-path-tree/badges/gpa.svg)](https://codeclimate.com/github/Spown/mongoose-path-tree)
[![Test Coverage](https://codeclimate.com/github/Spown/mongoose-path-tree/badges/coverage.svg)](https://codeclimate.com/github/Spown/mongoose-path-tree/coverage)
[![Issue Count](https://codeclimate.com/github/Spown/mongoose-path-tree/badges/issue_count.svg)](https://codeclimate.com/github/Spown/mongoose-path-tree)

[![Dependency Status](https://david-dm.org/Spown/mongoose-path-tree.svg)](https://david-dm.org/Spown/mongoose-path-tree)
[![devDependency Status](https://david-dm.org/Spown/mongoose-path-tree/dev-status.svg)](https://david-dm.org/Spown/mongoose-path-tree#info=devDependencies)

Implements the materialized path strategy with cascade child re-parenting on delete for storing a hierarchy of documents with mongoose
Version with all collected features and fixes from mongoose-tree, mongoose-tree-fix, mongoose-tree2, mongoose-reparenting-tree

# Usage

Install via NPM

    $ npm install mongoose-path-tree

## Options

```javascript
Model.plugin(tree, {
  pathSeparator : '#',              // Path separator. Default: '#'
  onDelete :      'REPARENT',       // Can be set to 'DELETE' or 'REPARENT'. Default: 'DELETE'
  numWorkers:     5,                // Number of stream workers. Default: 5
  idType:         Schema.ObjectId   // Type used for _id. Default: This Model Schema's _id type
  treeOrdering: false || 'position_field_name' // adds a "position" field for siblings on the same level to be moved and swapped
})
```

Then you can use the plugin on your schemas

```javascript
var tree = require('mongoose-path-tree');

var UserSchema = new Schema({
  name : String
});
UserSchema.plugin(tree);
var User = mongoose.model('User', UserSchema);

var adam = new User({ name : 'Adam' });
var bob = new User({ name : 'Bob' });
var carol = new User({ name : 'Carol' });

// Set the parent relationships
bob.parent = adam;
carol.parent = bob;

adam.save(function() {
  bob.save(function() {
    carol.save();
  });
});
```

At this point in mongoDB you will have documents similar to
```js
    {
      "_id" : ObjectId("50136e40c78c4b9403000001"),
      "name" : "Adam",
      "path" : "50136e40c78c4b9403000001"
    }
    {
      "_id" : ObjectId("50136e40c78c4b9403000002"),
      "name" : "Bob",
      "parent" : ObjectId("50136e40c78c4b9403000001"),
      "path" : "50136e40c78c4b9403000001#50136e40c78c4b9403000002"
    }
    {
      "_id" : ObjectId("50136e40c78c4b9403000003"),
      "name" : "Carol",
      "parent" : ObjectId("50136e40c78c4b9403000002"),
      "path" : "50136e40c78c4b9403000001#50136e40c78c4b9403000002#50136e40c78c4b9403000003"
    }
```
The path is used for recursive methods and is kept up to date by the plugin if the parent is changed

# API

### getChildren

Signature:
```js
doc.getChildren([filters], [fields], [options], [recursive], cb);
```
args are additional filters if needed.
if recursive is supplied and true, subchildren are returned

Based on the above hierarchy:

```js
adam.getChildren(function(err, users) {
  // users is an array of with the bob document
});

adam.getChildren(true, function(err, users) {
  // users is an array with both bob and carol documents
});
```

### getChildrenTree

Signature as a method:
```js
doc.getChildrenTree([args], cb);
```
Signature as a static:
```js
Model.getChildrenTree([rootDoc], [args], cb);
```
returns (``Object``): recursive tree of sub-children.

args is an object you can defined with theses properties :

 * __filters__: ``Object``, mongoose query filter, optional, default: ``{}``
 * __fields__:  ``String|Object``, mongoose fields, optional, default: ``null`` (all fields)
 * __options__: ``Object``, mongoose query option, optional, default: ``{}``
 * __minLevel__: ``Number``, level at which will start the search, default: ``1``
 * __recursive__: ``Boolean``, make the search recursive or only fetch children for the specified level, default: ``true``
 * __allowEmptyChildren__: ``Boolean``, if ``true``, every child not having children would still have ``children`` attribute (an empty array), if ``false``, every child not having children will have ``children`` attribute at all, default: ``true``
 * __objectify__: ``Boolean|Object``, wheather to run [``toObject()``](http://mongoosejs.com/docs/api.html#document_Document-toObject) method on every child, can be either ``Boolean`` or an ``toObject()`` options ``Object``, default: ``false``
 * __populationQuery__: ``String``, populate fields, default: ``''``
      

Example :
```javascript
var args = {
  filters: {owner:myId},
  fields: "_id name owner",
  minLevel:2,
  recursive:true,
  allowEmptyChildren:false
}

getChildrenTree(args,myCallback);
```

Based on the above hierarchy:

```javascript
adam.getChildrenTree( function(err, users) {

    /* if you dump users, you will have something like this :
    {
      "_id" : ObjectId("50136e40c78c4b9403000001"),
      "name" : "Adam",
      "path" : "50136e40c78c4b9403000001"
      "children" : [{
          "_id" : ObjectId("50136e40c78c4b9403000002"),
          "name" : "Bob",
          "parent" : ObjectId("50136e40c78c4b9403000001"),
          "path" : "50136e40c78c4b9403000001#50136e40c78c4b9403000002"
          "children" : [{
              "_id" : ObjectId("50136e40c78c4b9403000003"),
              "name" : "Carol",
              "parent" : ObjectId("50136e40c78c4b9403000002"),
              "path" : "50136e40c78c4b9403000001#50136e40c78c4b9403000002#50136e40c78c4b9403000003"
          }]
      }]
    }
    */

});

```

### getAncestors

Signature:
```js
doc.getAncestors([filters], [fields], [options], cb);
```
Based on the above hierarchy:

```javascript
carol.getAncestors(function(err, users) {
  // users as an array [adam, bob] (older -> younger)
})
```

### getSiblingsAndSelf
alias: siblingsAndSelf
```js
doc.getSiblingsAndSelf(function(err, docs) {
  
});
```
Returns this document's siblings and itself in an array

### getSiblings
alias: siblings
```js
doc.getSiblings(function(err, docs) {
  
});
```
Returns this document's siblings in an array

### moveToPosition
```js
doc.moveToPosition(positin, function(err, docs) {
  
});
```
Move this node to the specified position (number, zero-based) on the same level and swaps it with the other doc (also changes the target doc's position field value)

### level

Virtual property (``Number``, strating at 1), equals to the level in the hierarchy

```javascript
carol.level; // equals 3
```

# Tests

To run the tests install mocha

    npm install mocha -g

and then run

    mocha


