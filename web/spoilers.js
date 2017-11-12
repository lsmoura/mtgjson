"use strict";

var C = require('../shared/C'),
    dust = require('dustjs-helpers'),
    fs = require("fs"),
    path = require("path"),
    tiptoe = require("tiptoe"),
    winston = require("winston"),
    async = require('async');

require('@sembiance/xbase');

var dustData =  {
    title : "Spoilers"
};

/** Process each item on the vector */
Array.prototype.process = function(callback) {
    this.forEach(function(value, idx) {
        this[idx] = callback(value, idx);
    }.bind(this));
    return(this);
};

function mtgManaConvert(value) {
    value = value.replace('{', '').replace('}', '').replace('/', '').toLowerCase();
    if (value === "t")
        return('<i class="mtg tap"></i>');
    return('<i class="mtg mana-' + value + '"></i>');
}

// Stores all the loaded sets
var allSets = function(setName) {
    if (!allSets.cache) {
        allSets.cache = {};
    }

    if (allSets.cache[setName])
        return(allSets.cache[setName]);

    var ret = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "json", setName + ".json"), {encoding : "utf8"}))
    allSets.cache[setName] = ret;
    return(ret);
};

allSets.findMultiverseID = function(setName, multiverseid) {
    var set = allSets(setName);
    if (set == null) return(null);

    var ret = null;
    set.cards.forEach(function(card) {
        if (card.multiverseid == multiverseid)
            ret = card;
    });

    return(ret);
};

allSets.findCardName = function(setName, cardName) {
    var set = allSets(setName);
    if (set == null) return(null);

    var ret = null;
    var lcCardName = cardName.toLowerCase();
    set.cards.forEach(function(card) {
        if (card.name.toLowerCase() === lcCardName)
            ret = card;
    });

    return(ret);
}

// Generate spoilers
function generateSpoilerForSetName(setName, lang, cb) {
    lang = lang || 'en';
    var mySet = null;

    C.SETS.forEach(function(set) {
        if (set.code.toLowerCase() == setName.toLowerCase()) {
            mySet = set;
        }
    });

    if (mySet == null) {
        winston.error('Cannot find set %s', setName);
        if (cb) cb(null);
        return;
    }

    var set = null;

    tiptoe(
        function loadSet() {
            winston.info('Generating spoilers for set %s', setName);
            set = allSets(setName);
            this();
        },
        function renderHTML() {
            dustData.title = set.name + ' spoilers';
            dustData.setName = set.name;
            dustData.cards = set.cards;
            dustData.cards.forEach(function(card) {
                // mtgicons set class
                card.setClass = set.name.toLowerCase().replace(new RegExp(' ', 'g'), '-');
                if (card.rarity.toLowerCase() !== "common")
                    card.setClass += ' ' + card.rarity.toLowerCase();

                // mtgicons mana cost
                card.manaIcons = [];
                if (card.manaCost)
                    card.manaIcons = card.manaCost.match(/{[^}]*}/g).process(function(value) {
                        return('mana-' + value.replace('{', '').replace('}' ,'').replace('/' ,'').toLowerCase());
                    });

                // Line breaks
                if (card.text)
                    card.text = card.text
                        .replace(new RegExp('\n', 'g'), '<br />')
                        .replace(new RegExp('"', 'g'), '&quot;');
                if (card.flavor)
                    card.flavor = card.flavor
                        .replace(new RegExp('\n', 'g'), '<br />')
                        .replace(new RegExp('"', 'g'), '&quot;');

                // Other sets
                card.printingLinks = [];
                if (card.printings && card.rarity.toLowerCase() != "basic land") {
                    card.printings.forEach(function(printingName) {
                        if (printingName == setName) return;
                        var printingCard = allSets.findCardName(printingName, card.name);
                        var set = allSets(printingName);
                        if (!printingCard) {
                            winston.error("Cannot find card '%s' on set '%s'", printingName, card.name);
                            return;
                        }

                        var cssClass = set.name.toLowerCase().replace(/duel decks.*[,:] ?/, '').replace(new RegExp(' ', 'g'), '-').replace('.', '');
                        if (printingCard.rarity)
                            if (printingCard.rarity.toLowerCase() !== "common")
                                cssClass += ' ' + printingCard.rarity.toLowerCase();

                        var entry = {
                            id: printingCard.id,
                            lcSetName: printingName.toLowerCase(),
                            cssClass: cssClass
                        };
                        card.printingLinks.push(entry);
                    });
                }
                if (card.printingLinks.length == 0)
                    delete card.printingLinks;
            });
            dustData.dustText = function(val, idx) {
                var card = this.cards[this['$idx']];

                if (!card.text)
                    return('');

                var converted = card.text.replace(/{[^}]*}/g, mtgManaConvert);
                return(converted);
            }
            dustData.dustFlavor = function(val, idx) {
                var card = this.cards[this['$idx']];

                if (!card.flavor)
                    return('');

                var converted = card.flavor.replace(/{[^}]*}/g, mtgManaConvert);
                return(converted);
            }
            dustData.imgUrl = function(val, idx) {
                var card = this.cards[this['$idx']];
                var url = null;
                if (set.magicCardsInfoCode) {
                    var number = card.number;
                    if (card.mciNumber)
                        number = card.mciNumber;
                    url = 'http://magiccards.info/scans/en/' + set.magicCardsInfoCode + '/' + number + '.jpg';
                }

                return(url);
            }
            dustData.mciUrl = function(val, idx) {
                var card = this.cards[this['$idx']];

                var url = null;
                if (set.magicCardsInfoCode) {
                    var number = card.number;
                    if (card.mciNumber)
                        number = card.mciNumber;
                    url = 'http://magiccards.info/' + set.magicCardsInfoCode + '/en/' + number + '.html';
                }

                return(url);
            }

            fs.readFile(path.join(__dirname, "spoiler.dust"), {encoding:"utf8"}, function(err, data) {
                if (err) cb(err);
                dust.renderSource(data, dustData, cb);
            });
        },
        function finish(err, html) {
            if (err) throw(err);
            if (cb)
                cb(null, html);
        }
    );
}

async.eachSeries(
    C.SETS,
    function(setInfo, cb) {
        var setName = setInfo.code;
        if (setInfo.isMCISet) {
            setImmediate(cb);
            return;
        }

        tiptoe(
            function() {
                generateSpoilerForSetName(setName, null, this);
            },
            function saveSet(html) {
                fs.writeFile(path.join(__dirname, 'sets', setName.toLowerCase() + ".html"), html, { encoding: "utf8" }, this);
            },
            function finish(err) {
                if (err)
                    cb(err);
                cb();
            }
        );
    },
    function(err) {
        if (err) throw(err);
        winston.info('All done.');
    }
);
