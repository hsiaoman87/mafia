var express = require('express'),
    app = express(),
    routes = require('./routes'),
    http = require('http'),
    path = require('path'),
    server = http.createServer(app),
    io = require('socket.io').listen(server),
    mongoose = require('mongoose'),
	Schema = mongoose.Schema;

// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(express.methodOverride());
app.use(express.cookieParser('6362564423'));
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));

// development only
if ('development' == app.get('env')) {
    app.use(express.errorHandler());
}

mongoose.connect('mongodb://localhost/my_database');

var playerSchema = new Schema({
    id: String,
    isReady: {
        type: Boolean,
        default: false
    },
    name: {
        type: String,
        required: true
    },
    affiliation: Number,
    nominee: Boolean,
    voteApprove: Boolean,
    missionSuccess: Boolean
}, {
    toJSON: {
        transform: function (doc, ret, options) {
            delete ret.affiliation;
            delete ret.__v;
            delete ret._id;
        }
    }
});

playerSchema.pre('save', function (next) {
    if (this.isNew) {
        this.id = randomString(6);
    }
    next();
});

playerSchema.methods.update = function (newPlayer) {
    if (newPlayer.name !== undefined) {
        this.name = newPlayer.name;
    }
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
            iterations: [{
                vote: Boolean,
                teamMember: Boolean
            }]
        }],
        failedVoteCount: Number,
        failCount: Number,
        result: Boolean
	}],
	players: [playerSchema],
    isInitialized: Boolean
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
    console.log(this);
    next();
});

gameSchema.virtual('isReady').get(function () {
    if (this.players.length < 5) {
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
    
    if (this.isInitialized) {
        cb(new Error('Cannot add player because game has already started'));
    }
	else {
        this.players.push(player);
        
        if (this.isReady) {
            this.initialize();
        }
        this.save(cb);
    }
}

gameSchema.methods.updatePlayer = function (userId, newPlayer, cb) {
    beginMethod('updatePlayer(userId, newPlayer, cb)', arguments);
    
    if (this.isInitialized) {
        cb(new Error('Cannot update player because game has already started'));
    }
    else if (!this.players[userId]) {
        cb(new Error('Invalid player id'));
    }
    else {
        var player = this.players[userId];
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
    this.isInitialized = true;
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

gameSchema.methods.vote = function (playerId, approve, cb) {
    beginMethod('vote(playerId, approve, cb)', arguments);
    
    if (this.phase !== PHASE.Vote) {
        cb(new Error('Voting not allowed'));
    }
    else {
        this.players[playerId].voteApprove = approve;
        this._evaluateVote(cb);
    }
}

gameSchema.methods.mission = function (playerId, succeed, cb) {
    beginMethod('mission(playerId, succeed, cb)', arguments);
    
    if (this.phase !== PHASE.Mission) {
        cb(new Error('Not on a mission'));
    }
    else if (!this.players[playerId].nominee) {
        cb(new Error('Player is not on team'));
    }
    else {
        this.players[playerId].missionSuccess = succeed;
        this._evaluateMission(cb);
    }
}

gameSchema.methods._evaluateVote = function (cb) {
    beginMethod('_evaluateVote(cb)', arguments);
	
	var yesVotes = 0;
	var noVotes = 0;
	var historyEntry = {
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
                this.players[i].nominee = undefined;
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
            this.players[i].nominee = undefined;
            this.players[i].missionSuccess = undefined;
        }
	}
    
    this.save(cb);
}

var Game = mongoose.model('Game', gameSchema);

function randomString(len) {
    var charSet = 'abcdefghijklmnopqrstuvwxyz';
    var randomString = '';
    for (var i = 0; i < len; i++) {
        randomString += charSet.charAt(Math.floor(Math.random() * charSet.length));
    }
    return randomString;
}

app.param('id', function (req, res, next, id) {
    Game.findOne({
        id: id
    }, function (err, game) {
        if (err) {
            next(err);
        }
        else if (game) {
            if (req.cookies['userId']) {
                for (var i = 0; i < game.players.length; i++) {
                    if (game.players[i]._id.equals(req.cookies['userId'])) {
                        req.currentPlayerIndex = i;
                        break;
                    }
                }
            }
            
            req.game = game;
            next();
        }
        else {
            next(new Error('Game does not exist'));
        }
    });
});

// View start
app.get('/', function (req, res) {
    res.render('start', { title: 'Mafia' });
});

// View game
app.get('/:id', function (req, res, next) {
    if (req.game.isMultiDevice) {
        res.render('game_multi', {
            title: 'Play (multi-device)',
            data: {
                game: req.game,
                currentPlayerIndex: req.currentPlayerIndex
            }
        });
    }
    else {
        res.render('game_multi', {
            title: 'Play (single-device)',
            data: {
                game: req.game,
                currentPlayerIndex: req.currentPlayerIndex
            }
        });
    }
});

// Fetch game data
app.get('/:id/_api/game', function (req, res, next) {
    if (req.query.debug) {
        res.send(req.game.toObject());
    }
    else {
        res.send(req.game);
    }
});

// Fetch users
app.get('/:id/_api/users/:userId?', function (req, res, next) {
    if (req.params.userId === undefined) {
        res.send(req.game.players);
    }
    else if (req.game.players[req.params.userId]) {
        res.send(req.game.players[req.params.userId]);
    }
    else {
        res.send(400);
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

app.get('/impersonate/:id/:userId?', function (req, res, next) {
    if (req.game.isMultiDevice) {
        if (req.params.userId) {
            var foundUser = false;
            for (var i = 0; i < req.game.players.length; i++) {
                if (req.game.players[i].id === req.params.userId) {
                    res.cookie('userId', req.game.players[i]._id, { path: '/' + req.game.id });
                    foundUser = true;
                    break;
                }
            }
            if (!foundUser) {
                next(new Error('User not found'));
                return;
            }
        }
        else {
            res.clearCookie('userId', { path: '/' + req.params.id });
        }
        res.send(req.game);
    }
    else {
        next(new Error('Cannot join single-device game'));
    }
});

// Join game
app.post('/:id/_api/join', function (req, res, next) {
    if (req.game.isMultiDevice) {
        if (req.body.userId) {
            var foundUser = false;
            for (var i = 0; i < req.game.players.length; i++) {
                if (req.game.players[i].id === req.body.userId) {
                    res.cookie('userId', req.game.players[i]._id, { path: '/' + req.game.id });
                    foundUser = true;
                    break;
                }
            }
            if (!foundUser) {
                next(new Error('User not found'));
                return;
            }
        }
        res.send(req.game);
    }
    else {
        next(new Error('Cannot join single-device game'));
    }
});

// Add a user
app.post('/:id/_api/users', function (req, res, next) {
    req.game.addPlayer({
        name: req.body.name,
        isReady: req.body.isReady
    }, function (err, game) {
        if (err) {
            next(err);
        }
        else {
            var newPlayer = game.players[game.players.length - 1];
            res.cookie('userId', newPlayer._id, { path: '/' + game.id });
            res.send(newPlayer);
        }
    });
});

function validateUser (req, res, next) {
    if (req.game.players[req.params.userId]) {
        req.player = req.game.players[req.params.userId];
        req.playerIndex = req.params.userId;
    }
    else {
        for (var i = 0; i < req.game.players.length; i++) {
            if (req.game.players[i].id === req.params.userId) {
                req.player = req.game.players[i];
                req.playerIndex = i;
                break;
            }
        }
    }
    if (!req.player) {
        next(new Error('Invalid userid'));
    }
    else if (!req.cookies['userId'] || !req.player._id.equals(req.cookies['userId'])) {
        next(new Error('Cannot update someone else'));
    }
    else {
        console.log(req.player);
        next();
    }
}

// Update a user
app.patch('/:id/_api/users/:userId', validateUser, function (req, res, next) {
    if (!req.game.isMultiDevice) {
        res.send(400, 'Cannot update users in single-device game');
    }
    else if (!req.cookies['userId'] || !req.player._id.equals(req.cookies['userId'])) {
        res.send(400, 'Cannot update someone else');
    }
    else {
        req.game.updatePlayer(req.playerIndex, req.body, function (err, game) {
            if (err) {
                next(err);
            }
            else {
                res.send(game.players[req.playerIndex]);
            }
        });
    }
});

// Nominate
app.post('/:id/_api/nominate', function (req, res, next) {
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
app.post('/:id/_api/:userId/vote', validateUser, function (req, res, next) {
    req.game.vote(req.params.userId, req.body.approve, function (err, game) {
        if (err) {
            next(err);
        }
        else {
            res.send(game);
        }
    });
});

// Mission
app.post('/:id/_api/:userId/mission', function (req, res, next) {
    req.game.mission(req.params.userId, req.body.succeed, function (err, game) {
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

function broadcast(socketName, message) {
    for (var socketId in sockets) {
        if (sockets.hasOwnProperty(socketId)) {
            sockets[socketId].emit(socketName, message);
        }
    }
}

var sockets = {};

io.sockets.on('connection', function (socket) {
    sockets[socket.id] = socket;

    socket.on('my other event', function (data) {
        console.log(data);
    });
    
    socket.on('add user', function (user) {
    });
    
    socket.on('disconnect', function () {
        delete sockets[socket.id];
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