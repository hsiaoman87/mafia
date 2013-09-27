var CONSTANTS = {
    RemoteAddress: 'http://66.26.86.96:3000'
}

var express = require('express'),
    app = express(),
    routes = require('./routes'),
    http = require('http'),
    path = require('path'),
    server = http.createServer(app),
    io = require('socket.io').listen(server),
    mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    passport = require('passport'),
    FacebookStrategy = require('passport-facebook').Strategy,
    GoogleStrategy = require('passport-google').Strategy;

// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(express.methodOverride());
app.use(express.cookieParser());
app.use(express.session({ secret: 'kirby' }));
app.use(passport.initialize());
app.use(passport.session());

app.use(function (req, res, next) {
    res.locals.req = req;
    next();
});
app.use(function (req, res, next) {
    if (typeof req.query.debug !== 'undefined') {
        req.debug = req.query.debug.bool();
    }
    else {
        req.debug = req.cookies['debug-mafia'];
    }
    next();
});

app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));

// development only
if ('development' == app.get('env')) {
    app.use(express.errorHandler());
}

mongoose.connect('mongodb://localhost/my_database');

function clearReferer(req, res, next) {
    console.log('current url: ' + req.url);
    console.log('deleting referer: ' + req.session.referer);
    delete req.session.referer;
    next();
}

function ensureAuthenticated (req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    
    if (req.route.method === 'get') {
        req.session.referer = req.url;
        console.log('saving referer: ' + req.session.referer);
        res.redirect('/login');
    }
    else {
        next(new Error('Not authenticated'));
    }
}

function validateUser (req, res, next) {
    if (!req.game.players[req.params.playerIndex]) {
        next(new Error('Invalid playerIndex'));
    }
    else if (req.currentPlayerIndex !== +req.params.playerIndex) {
        console.log(req.currentPlayerIndex + ' !== ' + req.params.playerIndex);
        next(new Error('Cannot update someone else'));
    }
    else {
        next();
    }
}

function postAuthenticate(req, res) {
    if (req.session.referer) {
        var referer = req.session.referer;
        
        console.log('clearing referer: ' + req.session.referer);
        delete req.session.referer;
        res.redirect(referer);
    }
    else {
        res.redirect('/');
    }
}

passport.use(
    new FacebookStrategy({
        clientID: '438271556283546',
        clientSecret: '060b9433305213195103d15e2345e372',
        callbackURL: CONSTANTS.RemoteAddress + '/auth/facebook/callback'
    },
    function (accessToken, refreshToken, profile, done) {
        console.log('facebook callback');
        console.log(arguments);
        
        User.findOneAndUpdate({ facebookId: profile.id }, {
            name: (profile.name && profile.name.givenName) || profile.displayName
        }, { upsert: true }, done);
    })
);

passport.use(
    new GoogleStrategy({
        returnURL: CONSTANTS.RemoteAddress + '/auth/google/return',
        realm: CONSTANTS.RemoteAddress
    },
    function (identifier, profile, done) {
        console.log('google callback');
        console.log(arguments);
        
        User.findOneAndUpdate({ googleId: identifier }, {
            name: (profile.name && profile.name.givenName) || profile.displayName
        }, { upsert: true }, done);
    })
);

passport.serializeUser(function (user, done) {
    console.log(user);
    done(null, user._id);
});

passport.deserializeUser(function (obj, done) {
    User.findById(obj, done);
});

app.get('/auth/facebook', passport.authenticate('facebook'));
app.get('/auth/facebook/callback', passport.authenticate('facebook'), postAuthenticate);

app.get('/auth/google', passport.authenticate('google'));
app.get('/auth/google/return', passport.authenticate('google'), postAuthenticate);

app.post('/auth/guest', function (req, res, next) {
    if (req.body.name && req.body.name.trim()) {
        console.log(req.body.name);
        User.create({
            name: req.body.name.trim()
        }, function (err, newUser) {
            if (err) {
                next(err);
            }
            else {
                req.login(newUser, function (err) {
                    if (err) {
                        return next(err);
                    }
                    else {
                        res.send(201);
                    }
                });
            }
        });
    }
    else {
        res.send(400);
    }
});

app.get('/logout', function (req, res) {
    console.log('logging out');
    req.logout();
    res.redirect('/');
});

app.get('/login', function (req, res) {
    res.render('login', {
        title: 'Login',
        user: req.user
    });
});

var userSchema = new Schema({
    facebookId: {
        type: String
    },
    googleId: {
        type: String
    },
    name: {
        type: String,
        required: true
    }
});

var User = mongoose.model('User', userSchema);

var playerSchema = new Schema({
    isReady: {
        type: Boolean,
        default: false
    },
    affiliation: Number,
    nominee: Boolean,
    voteApprove: Boolean,
    missionSuccess: Boolean,
    user: { type: String, ref: 'User' }
}, {
    toJSON: {
        transform: function (doc, ret, options) {
            if (!options.showAffiliation) {
                delete ret.affiliation;
            }
            delete ret.__v;
            delete ret._id;
        }
    }
});

playerSchema.virtual('name').get(function () {
    return this.user.name;
});

playerSchema.virtual('hasVoted').get(function () {
    return !isNaN(this.voteApprove);
});

playerSchema.virtual('hasMissioned').get(function () {
    return !isNaN(this.missionSuccess);
});

playerSchema.methods.update = function (newPlayer) {
    if (newPlayer.isReady !== undefined) {
        this.isReady = newPlayer.isReady;
    }
}

var gameSchema = new Schema({
    id: String,
    isMultiDevice: Boolean,
	leaderIndex: Number,
	currentRound: Number,
	phase: String,
	rounds: [{
		history: [{
            leaderIndex: Number,
            iterations: [{
                vote: Boolean,
                teamMember: Boolean
            }]
        }],
        failedVoteCount: Number,
        failCount: Number,
        result: Boolean
	}],
	players: [playerSchema]
}, {
    toJSON: {
        transform: function (doc, ret, options) {
            if (doc.ownerDocument) {
                // player
                delete ret.affiliation;
            }
            delete ret.__v;
            delete ret._id;
        }
    }
});

gameSchema.pre('save', function (next) {
    if (this.isNew) {
        if (this.isMultiDevice) {
            if (this.players && this.players.length) {
                next(new Error('Cannot set players for multi-device'));
                return;
            }
        }
        else {
            if (this.players.length < 5) {
                next(new Error('Not enough players'));
                return;
            }
            else if (this.players.length > 10) {
                next(new Error('Too many players'));
                return;
            }
            else {
                this.initialize();
            }
        }
        this.id = randomString(6);
    }
    next();
});

gameSchema.post('save', function (game) {
    Game.findOne({ id: this.id }).populate('players.user').exec(function (err, game) {
        console.log('saving');
        sendRefresh(game.toJSON({ virtuals: true, transform: true }));
    });
});

gameSchema.virtual('isReady').get(function () {
    if (!this.players || this.players.length < 5) {
        return false;
    }
    for (var i = 0; i < this.players.length; i++) {
        if (!this.players[i].isReady) {
            return false;
        }
    }
    
    return true;
});

gameSchema.methods.addPlayer = function (player, cb) {
    beginMethod('addPlayer(player, cb)', arguments);
    
	if (this.phase === PHASE.Init) {
        this.players.push(player);
        this.save(cb);
    }
    else {
        cb(new Error('Cannot add player because game has already started'));
    }
}

gameSchema.methods.removePlayer = function (playerIndex, cb) {
    beginMethod('removePlayer(playerIndex, cb)', arguments);
    
    if (this.phase !== PHASE.Init) {
        cb(new Error('Cannot add player because game has already started'));
    }
    else if (!this.players[playerIndex]) {
        console.log(this.players);
        console.log(playerIndex);
        cb(new Error('Player does not exist'));
    }
	else {
        this.players.splice(playerIndex, 1);
        this.save(cb);
    }
}

gameSchema.methods.updatePlayer = function (playerIndex, newPlayer, cb) {
    beginMethod('updatePlayer(playerIndex, newPlayer, cb)', arguments);
    
    if (this.phase !== PHASE.Init) {
        console.log(this.phase);
        console.log(PHASE.Init);
        cb(new Error('Cannot update player because game has already started'));
    }
    else if (!this.players[playerIndex]) {
        cb(new Error('Invalid player id'));
    }
    else {
        var player = this.players[playerIndex];
        player.update(newPlayer, cb);
        
        if (this.isReady) {
            this.initialize();
        }
        this.save(cb);
    }
}

gameSchema.methods.initialize = function () {
    beginMethod('initialize()', arguments);
	
    var mafiaCount = gameData[this.players.length].mafiaCount;

    // assign affiliation
    shuffle(this.players);
    for (var i = 0; i < this.players.length; i++) {
        this.players[i].affiliation = i < mafiaCount ? AFFILIATION.Mafia : AFFILIATION.Townsperson;
    }

    // set order
    shuffle(this.players);
    
    this.leaderIndex = 0;
    this.currentRound = 0;
    this.phase = PHASE.Nominate;
}

gameSchema.methods.nominate = function (ids, cb) {
    beginMethod('nominate(ids, cb)', arguments);
    
    if (this.phase !== PHASE.Nominate) {
        cb(new Error('Nominations not accepted'));
    }
    else if (!(ids instanceof Array)) {
        cb(new Error('Invalid ids'));
    }
    else if (ids.length != gameData[this.players.length].teamCount[this.currentRound]) {
        cb(new Error('Incorrect number of nominees'));
    }
    else {
        for (var i = 0; i < ids.length; i++) {
            var player = this.players[ids[i]];
            
            if (player.nominee) {
                cb(new Error('Duplicate nominee'));
                return;
            }
            player.nominee = true;
        }
        
        this.phase = PHASE.Vote;
        this.save(cb);
    }
}

gameSchema.methods.vote = function (playerIndex, approve, cb) {
    beginMethod('vote(playerIndex, approve, cb)', arguments);
    
    if (this.phase !== PHASE.Vote) {
        cb(new Error('Voting not allowed'));
    }
    else {
        if (typeof approve === 'boolean') {
            this.players[playerIndex].voteApprove = approve;
        }
        else {
            this.players[playerIndex].voteApprove = undefined;
        }
        this._evaluateVote(cb);
    }
}

gameSchema.methods.mission = function (playerIndex, succeed, cb) {
    beginMethod('mission(playerIndex, succeed, cb)', arguments);
    
    if (this.phase !== PHASE.Mission) {
        cb(new Error('Not on a mission'));
    }
    else if (!this.players[playerIndex].nominee) {
        cb(new Error('Player is not on team'));
    }
    else {
        if (typeof succeed === 'boolean') {
            this.players[playerIndex].missionSuccess = succeed;
        }
        else {
            this.players[playerIndex].missionSuccess = undefined;
        }
        this._evaluateMission(cb);
    }
}

gameSchema.methods._evaluateVote = function (cb) {
    beginMethod('_evaluateVote(cb)', arguments);
	
	var yesVotes = 0;
	var noVotes = 0;
	var historyEntry = {
        leaderIndex: this.leaderIndex,
        iterations: []
    };
    
    for (var i = 0; i < this.players.length; i++) {
        var player = this.players[i];
        if (player.voteApprove === undefined) {
            break;
        }
        else if (player.voteApprove) {
            yesVotes++;
        }
        else {
            noVotes++;
        }
        historyEntry.iterations.push({
            vote: player.voteApprove,
            teamMember: player.nominee === true
        });
    }
    
	if (yesVotes + noVotes === this.players.length) {
		var round = this.rounds[this.currentRound];
        if (!round) {
            this.rounds.push({
                history: [],
                failedVoteCount: 0
            });
            round = this.rounds[this.currentRound];
        }
        
		round.history.push(historyEntry);
		
		if (yesVotes > noVotes) {
			console.log('Vote passed ' + yesVotes + ' to ' + noVotes + '.');
			this.phase = PHASE.Mission;
		}
		else {
            round.failedVoteCount++;
			console.log('Vote failed ' + noVotes + ' to ' + yesVotes + '. ' + round.failedVoteCount + ' failed votes.');
            
			if (round.failedVoteCount === 5) {
				this.phase = PHASE.Final;
				console.log('Game over');
			}
			else {
				this.phase = PHASE.Nominate;
				this.leaderIndex = ++this.leaderIndex % this.players.length;
			}
            
            for (var i = 0; i < this.players.length; i++) {
                this.players[i].nominee = false;
            }
		}
		
		for (var i = 0; i < this.players.length; i++) {
            this.players[i].voteApprove = undefined;
        }
	}
    this.save(cb);
}

gameSchema.methods._evaluateMission = function (cb) {
    beginMethod('_evaluateMission(cb)', arguments);
	
	var yesVotes = 0;
	var noVotes = 0;
    
    for (var i = 0; i < this.players.length; i++) {
        var player = this.players[i];
        if (player.nominee) {
            if (player.missionSuccess === undefined) {
                break;
            }
            else if (player.missionSuccess) {
                yesVotes++;
            }
            else {
                noVotes++;
            }
        }
    }
	
	if (yesVotes + noVotes === gameData[this.players.length].teamCount[this.currentRound]) {
		
		var round = this.rounds[this.currentRound];
		round.failCount = noVotes;
		round.result = noVotes < gameData[this.players.length].failuresNeeded[this.currentRound];
		
		var successfulMissions = 0;
		var failedMissions = 0;
		for (var i = 0; i < this.rounds.length; i++) {
            if (this.rounds[i].result) {
				successfulMissions++;
			}
			else {
				failedMissions++;
			}
		}
		if (successfulMissions === 3 || failedMissions === 3) {
			this.phase = PHASE.Final;
			console.log('Game over.');
		}
		else {
			this.phase = PHASE.Nominate;
			this.currentRound++;
            this.leaderIndex = ++this.leaderIndex % this.players.length;
			
			if (round.result) {
				console.log('Mission succeeded!');
			}
			else {
				if (noVotes > 1) {
					console.log('Mission failed with ' + noVotes + ' saboteurs!');
				}
				else {
					console.log('Mission failed with 1 saboteur!');
				}
			}
		}
		
        for (var i = 0; i < this.players.length; i++) {
            this.players[i].nominee = false;
            this.players[i].missionSuccess = undefined;
        }
	}
    
    this.save(cb);
}

var Game = mongoose.model('Game', gameSchema);

app.param('id', function (req, res, next, id) {
    Game.findOne({
        id: { $regex: new RegExp(id, 'i') }
    }).populate('players.user').exec(function (err, game) {
        if (err) {
            next(err);
        }
        else if (game) {
            if (req.user) {
                for (var i = 0; i < game.players.length; i++) {
                    if (game.players[i].user.id === req.user.id) {
                        req.currentPlayerIndex = i;
                        break;
                    }
                }
            }
            
            console.log('setting req.game');
            req.game = game;
            next();
        }
        else {
            next(new Error('Game does not exist'));
        }
    });
});

// View start
app.get('/', clearReferer, function (req, res) {
    res.render('start', { title: 'Mafia' });
});

// View game
app.get('/:id', ensureAuthenticated, clearReferer, function (req, res, next) {
    var showAffiliation = req.game.players[req.currentPlayerIndex] && req.game.players[req.currentPlayerIndex].affiliation === AFFILIATION.Mafia;
    console.log('currentPlayerIndex' + req.currentPlayerIndex);
    res.render('game_multi', {
        title: 'Play',
        data: {
            game: req.game.toJSON({ virtuals: true, transform: true, showAffiliation: showAffiliation }),
            user: req.user,
            currentPlayerIndex: req.currentPlayerIndex,
            debug: req.debug
        }
    });
});

// Fetch game data
app.get('/:id/_api/game', function (req, res, next) {
    if (req.debug) {
        res.send(req.game.toObject({ virtuals: true }));
    }
    else {
        var showAffiliation = req.game.players[req.currentPlayerIndex] && req.game.players[req.currentPlayerIndex].affiliation === AFFILIATION.Mafia;
        console.log('showAffiliation: ' + showAffiliation);
        res.send(req.game.toJSON({ transform: true, showAffiliation: showAffiliation }));
    }
});

// Fetch users
app.get('/:id/_api/users/:playerIndex?', function (req, res, next) {
    if (req.params.playerIndex === undefined) {
        res.send(req.game.players);
    }
    else if (req.game.players[req.params.playerIndex]) {
        res.send(req.game.players[req.params.playerIndex]);
    }
    else {
        if (!isNaN(req.currentPlayerIndex)) {
            console.log(req.game.players[req.currentPlayerIndex].toJSON({ virtuals: true, transform: true, showAffiliation: true}));
            res.send(req.game.players[req.currentPlayerIndex].toJSON({ virtuals: true, transform: true, showAffiliation: true}));
        }
        else {
            res.send(400);
        }
    }
});

// Fetch rounds
app.get('/:id/_api/rounds/:roundId?', function (req, res, next) {
    if (req.params.roundId === undefined) {
        res.send(req.game.rounds);
    }
    else if (req.game.rounds[req.params.roundId]) {
        res.send(req.game.rounds[req.params.roundId]);
    }
    else {
        res.send(400);
    }
});

// Create new game
app.post('/', function (req, res, next) {
    Game.create({
        phase: PHASE.Init,
        isMultiDevice: req.body.isMultiDevice,
        players: req.body.players,
    }, function (err, newGame) {
        if (err) {
            next(err);
        }
        else {
            // TODO: handle if game already exists
            res.send(newGame);
        }
    });
});

// Impersonate another user (debug)
app.get('/impersonate/:id/:playerIndex?', function (req, res, next) {
    if (!req.debug) {
        next(new Error('Forbidden'));
    }
    else if (!req.game.isMultiDevice) {
        next(new Error('Cannot join single-device game'));
    }
    else {
        if (req.params.playerIndex) {
            if (req.game.players[req.params.playerIndex]) {
                req.login(req.game.players[req.params.playerIndex].user, function (err) {
                    if (err) {
                        return next(err);
                    }
                    else {
                        res.send(req.game.players[req.params.playerIndex].user);
                    }
                });
            }
            else {
                next(new Error('User not found'));
            }
        }
        else {
            req.logout();
            res.send();
        }
    }
});

// Join game
app.post('/:id/_api/join', function (req, res, next) {
    if (req.game.isMultiDevice) {
        res.send(req.game);
    }
    else {
        next(new Error('Cannot join single-device game'));
    }
});

// Add a user
app.post('/:id/_api/users', ensureAuthenticated, function (req, res, next) {
    var userId = req.user._id.toString();
    for (var i = 0; i < req.game.players.length; i++) {
        if (req.game.players[i].user.id === userId) {
            next(new Error('Already joined'));
            return;
        }
    }
    req.game.addPlayer({
        user: userId
    }, function (err, game) {
        if (err) {
            next(err);
        }
        else {
            for (var i = 0; i < game.players.length; i++) {
                if (game.players[i].user === userId) {
                    res.send({ playerIndex: i });
                    return;
                }
            }
            res.send(400);
        }
    });
});

// Remove a user
app.delete('/:id/_api/users/:playerIndex', ensureAuthenticated, validateUser, function (req, res, next) {
    req.game.removePlayer(req.params.playerIndex, function (err, game) {
        if (err) {
            next(err);
        }
        else {
            res.send(204);
        }
    });
});

// Update a user
app.patch('/:id/_api/users/:playerIndex', ensureAuthenticated, validateUser, function (req, res, next) {
    if (!req.game.isMultiDevice) {
        res.send(400, 'Cannot update users in single-device game');
    }
    else {
        req.game.updatePlayer(req.params.playerIndex, req.body, function (err, game) {
            if (err) {
                next(err);
            }
            else {
                if (game.isReady) {
                    io.sockets.in(game.id).emit('start');
                }
                res.send(200);
            }
        });
    }
});

// Nominate
app.post('/:id/_api/nominate', ensureAuthenticated, function (req, res, next) {
    if (req.currentPlayerIndex !== req.game.leaderIndex) {
        next(new Error('Must be leader to nominate'));
    }
    else {
        req.game.nominate(req.body.ids, function (err, game) {
            if (err) {
                next(err);
            }
            else {
                res.send(game);
            }
        });
    }
});

// Vote
app.post('/:id/_api/:playerIndex/vote', ensureAuthenticated, validateUser, function (req, res, next) {
    req.game.vote(req.params.playerIndex, req.body.approve.bool(), function (err, game) {
        if (err) {
            next(err);
        }
        else {
            res.send(game);
        }
    });
});

// Mission
app.post('/:id/_api/:playerIndex/mission', ensureAuthenticated, validateUser, function (req, res, next) {
    req.game.mission(req.params.playerIndex, req.body.succeed.bool(), function (err, game) {
        if (err) {
            next(err);
        }
        else {
            res.send(game);
        }
    });
});

server.listen(app.get('port'), function(){
    console.log('Express server listening on port ' + app.get('port'));
});

io.sockets.on('connection', function (socket) {
    console.log('connected!');
    socket.emit('connection');
    socket.on('join', function (data) {
        socket.join(data.room);
    });
});

var gameData = {
    5: {
        mafiaCount: 2,
        teamCount: [2, 3, 2, 3, 3],
        failuresNeeded: [1, 1, 1, 1, 1]
    },
    6: {
        mafiaCount: 2,
        teamCount: [2, 3, 4, 3, 4],
        failuresNeeded: [1, 1, 1, 1, 1]
    },
    7: {
        mafiaCount: 3,
        teamCount: [2, 3, 3, 4, 4],
        failuresNeeded: [1, 1, 1, 2, 1]
    },
    8: {
        mafiaCount: 3,
        teamCount: [3, 4, 4, 5, 5],
        failuresNeeded: [1, 1, 1, 2, 1]
    },
    9: {
        mafiaCount: 3,
        teamCount: [3, 4, 4, 5, 5],
        failuresNeeded: [1, 1, 1, 2, 1]
    },
    10: {
        mafiaCount: 4,
        teamCount: [3, 4, 4, 5, 5],
        failuresNeeded: [1, 1, 1, 2, 1]
    }
};

var AFFILIATION = {
    Mafia: 0,
    Townsperson: 1
}

var PHASE = {
    Init: 'init',
    Nominate: 'nominate',
    Vote: 'vote',
    Mission: 'mission',
	Final: 'final'
}

// Shuffle an array
function shuffle (myArray) {
    myArray.sort(function () {
        return Math.random() - 0.5;
    });
}

function beginMethod (methodName, args) {
    console.log('begin method: ' + methodName);
    console.log('params:');
    console.log(args);
}

function sendRefresh(game) {
    io.sockets.in(game.id).emit('refresh', game);
}

function randomString(len) {
    var charSet = 'abcdefghijklmnopqrstuvwxyz';
    var randomString = '';
    for (var i = 0; i < len; i++) {
        randomString += charSet.charAt(Math.floor(Math.random() * charSet.length));
    }
    return randomString;
}

String.prototype.bool = function() {
    if ((/^true$/i).test(this)) {
        return true;
    }
    else if ((/^false$/i).test(this)) {
        return false;
    }
    else {
        return null;
    }
};