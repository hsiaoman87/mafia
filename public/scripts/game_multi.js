$(function () {
    ko.subscribable.fn.subscribeChanged = function (callback) {
        var oldValue;
        this.subscribe(function (_oldValue) {
            oldValue = _oldValue;
        }, this, 'beforeChange');
        
        this.subscribe(function (newValue) {
            callback(newValue, oldValue);
        });
    };
    
    $(document).ajaxError(function (e, jqXHR) {
        if (jqXHR.responseText) {
            alert(jqXHR.responseText);
        }
    });
    
    $(document).keydown(function (e) {
        if (gameModel.debug) {
            if (e.which === 27) {
                gameModel.unimpersonate();
            }
            else if (e.shiftKey) {
                var playerIndex = e.which - 48;
                if (gameModel.players()[playerIndex]) {
                    gameModel.players()[playerIndex].impersonate();
                }
            }
        }
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
    }

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
    
    function Game(data) {
        var self = this;
        self.debug = data.debug;
        self.leaderIndex = ko.observable();
        self.currentRound = ko.observable();
        ko.mapping.fromJS(data.game, {
            copy: ['id'],
            players: {
                create: function (options) {
                    return new Player(options.data, self);
                },
                key: function (data) {
                    return ko.utils.unwrapObservable(data.id);
                }
            },
            rounds: {
                create: function (options) {
                    return new Round(options.data, self);
                },
                key: function (data) {
                    return ko.utils.unwrapObservable(data.id);
                }
            }
        }, this);
        
        self.getAffiliation = function (callback) {
            $.get('/' + self.id + '/_api/game', null, function (game) {
                console.log('getAffiliation');
                console.log(game);
                ko.mapping.fromJS(game, self);
                
                if ($.isFunction(callback)) {
                    callback(game);
                }
            });
        }
        
        self.socket = io.connect('/');
        self.socket.on('connection', function () {
            self.socket.emit('join', { room: self.id });
        });
        self.socket.on('refresh', function (game) {
            console.log('refreshed');
            console.log(game);
            ko.mapping.fromJS(game, self);
        });
        self.socket.on('start', function () {
            self.getAffiliation(function () {
                self.currentPlayer().displayAffiliation();
            });
        });
        
        self.user = ko.observable(new Player(data.user, self));
        
        self.currentPlayer = ko.computed(function () {
            return $.grep(self.players(), function (player) {
                return player.user.id() === self.user()._id();
            })[0] || self.user();
        });
        
        self.teamSize = ko.computed(function () {
            if (gameData[self.players().length]) {
                return gameData[self.players().length].teamCount[self.currentRound()];
            }
            else {
                return null;
            }
        });
        
        self.candidates = ko.computed(function () {
            return $.grep(self.players(), function (player) {
                return player.nominee();
            });
        });
        
        self.scores = ko.computed(function () {
            return $.map(self.rounds(), function (round) {
                var result = round.result();
                return isNaN(result) ? null : result;
            });
        });
        
        self.displayVoteResults = function () {
            var currentHistory = self.rounds()[self.currentRound()].history();
            var playerIterations = currentHistory[currentHistory.length - 1].playerIterations();
            
            var approvals = [];
            var rejections = [];
            
            $.each(playerIterations, function (index, playerIteration) {
                if (playerIteration.voteDecision()) {
                    approvals.push(playerIteration);
                }
                else {
                    rejections.push(playerIteration);
                }
            });
            
            var message = approvals.length > rejections.length ? 'Vote approved!' : 'Vote rejected!';
            
            if (approvals.length) {
                message += '\n\nApproved by:';
                $.each(approvals, function (index, approval) {
                    message += '\n' + approval.name();
                });
            }
            if (rejections.length) {
                message += '\n\nRejected by:';
                $.each(rejections, function (index, rejection) {
                    message += '\n' + rejection.name();
                });
            }
            
            alert(message);
        }
        
        self.rounds.subscribeChanged(function (newRounds, oldRounds) {
            if (newRounds.length !== oldRounds.length) {
                self.displayVoteResults();
            }
        });
        
        self.currentLeader = ko.computed(function () {
            return self.players()[self.leaderIndex()];
        });
        
        self.isLeader = ko.computed(function () {
            return self.currentLeader() === self.currentPlayer();
        });
        
        self.submitNominees = function () {
            var nomineeIds = [];
            $.each(self.players(), function (index, player) {
                if (player.isSelected()) {
                    nomineeIds.push(index);
                }
            });
            
            $.post('/' + self.id + '/_api/nominate', {
                ids: nomineeIds
            },
            function (game) {
                $.each(self.players(), function (index, player) {
                    player.isSelected(false);
                });
            });
        }
        
        self.failuresNeeded = ko.computed(function () {
            if (self.phase() != PHASE.Init) {
                return gameData[self.players().length].failuresNeeded[self.currentRound()];
            }
            else {
                return null;
            }
        });
        
        self.unimpersonate = function () {
            $.ajax({
                url: '/impersonate/' + self.id,
                success: function() {
                    location.reload();
                },
                global: false
            });
        }
        
        self.mafiaPlayers = ko.computed(function () {
            return $.grep(self.players(), function (player) {
                return player.affiliation() === AFFILIATION.Mafia;
            });
        });
        
        self.winningAffiliation = ko.computed(function () {
            var successfulMissions = 0;
            var failedMissions = 0;
            $.each(self.rounds(), function (index, round) {
                if (round.result) {
                    successfulMissions++;
                }
                else {
                    failedMissions++;
                }
            });
            if (successfulMissions === 3) {
                return AFFILIATION.Townsperson;
            }
            else if (failedMissions === 3) {
                return AFFILIATION.Mafia;
            }
            else {
                return null;
            }
        });
    }
    
    //$('.toggle-button').button();
    $('button').button();
    
    function Round(data, game) {
        var self = this;
        self.result = ko.observable();
        self.failCount = ko.observable();
        ko.mapping.fromJS(data, {
            history: {
                create: function (options) {
                    return new HistoryEntry(options.data, game);
                },
                key: function (data) {
                    return ko.utils.unwrapObservable(data.id);
                }
            }
        }, this);
        
        self.result.subscribe(function (result) {
            if (result) {
                alert('Mission succeeded!');
            }
            else {
                if (self.failCount() > 1) {
                    alert('Mission failed with ' + self.failCount() + ' saboteurs!');
                }
                else {
                    alert('Mission failed with one saboteur!')
                }
            }
        });
        
        self.history.subscribeChanged(function (newHistory, oldHistory) {
            if (newHistory.length !== oldHistory.length) {
                gameModel.displayVoteResults();
            }
        });
    }
    
    function HistoryEntry(data, game) {
        var self = this;
        ko.mapping.fromJS(data, {
            key: function (data) {
                return ko.utils.unwrapObservable(data.id);
            }
        }, this);
        
        self.playerIterations = ko.computed(function () {
            return $.map(self.iterations(), function (iteration, index) {
                return $.extend({
                    voteDecision: iteration.vote,
                    isTeamMember: iteration.teamMember
                }, game.players()[index]);
            });
        });
        
        self.voteCounts = ko.computed(function () {
            var approveCount = 0;
            var rejectCount = 0;
            $.each(self.iterations(), function (index, iteration) {
                if (iteration.vote()) {
                    approveCount++;
                }
                else {
                    rejectCount++;
                }
            });
            
            return {
                approveCount: approveCount,
                rejectCount: rejectCount
            };
        });
        
        self.leader = ko.computed(function () {
            return game.players()[self.leaderIndex()];
        });
        
        self.teamMembers = ko.computed(function () {
            return $.grep(self.playerIterations(), function (player, index) {
                return player.isTeamMember();
            });
        });
    }
    
    function Player(data, gameModel) {
        var self = this;
        
        self.hasVoted = ko.observable();
        self.hasMissioned = ko.observable();
        self.voteApprove = ko.observable();
        self.missionSuccess = ko.observable();
        self.affiliation = ko.observable(AFFILIATION.Townsperson);
        self.isSelected = ko.observable(false);
        self.nominee = ko.observable(false);
        self.isReady = ko.observable(false);
        self.name = ko.observable();
        self.id = ko.observable();
        ko.mapping.fromJS(data, {
        }, this);
        
        self.hasVoted.subscribe(function (hasVoted) {
            if (!hasVoted) {
                self.voteApprove(null);
            }
        }); 
        
        self.hasMissioned.subscribe(function (hasMissioned) {
            if (!hasMissioned) {
                self.missionSuccess(null);
            }
        }); 
        
        self.voteApproved = ko.computed(function () {
            return self.hasVoted() && self.voteApprove();
        });
        
        self.voteRejected = ko.computed(function () {
            return self.hasVoted() && !self.voteApprove();
        });
        
        self.missionSucceeded = ko.computed(function () {
            return self.hasMissioned() && self.missionSuccess();
        });
        
        self.missionFailed = ko.computed(function () {
            return self.hasMissioned() && !self.missionSuccess();
        });
        
        self.affiliationName = ko.computed(function () {
            return self.affiliation() === AFFILIATION.Mafia ? 'Mafia' : 'Townspeople';
        });
        
        self.playerIndex = ko.computed(function () {
            return gameModel.players.mappedIndexOf(self);
        });
        
        self.impersonate = function () {
            var playerIndex = gameModel.players.mappedIndexOf(self);
            $.ajax({
                url: '/impersonate/' + gameModel.id + '/' + playerIndex,
                success: function (data) {
                    ko.mapping.fromJS(data, gameModel.user());
                    console.log('impersonate');
                    console.log(data);
                    gameModel.getAffiliation();
                },
                global: false
            });
        }
        
        self.displayAffiliation = function () {
            var message;
            if (self.affiliation() === AFFILIATION.Mafia) {
                message = 'You are mafia.  Here are your teammates:\n';
                $.each(gameModel.mafiaPlayers(), function (index, player) {
                    message += '\n' + player.name();
                });
            }
            else {
                message = 'You are a townsperson.  There are ' + gameData[gameModel.players().length].mafiaCount + ' mafia in the game.';
            }
            alert(message);
        }
        
        self.vote = function (approve) {
            var playerIndex = gameModel.players.mappedIndexOf(self);
            $.post('/' + gameModel.id + '/_api/' + playerIndex + '/vote', {
                approve: self.voteApprove() === approve ? null : approve
            });
        }
        
        self.mission = function (succeed) {
            var playerIndex = gameModel.players.mappedIndexOf(self);
            $.post('/' + gameModel.id + '/_api/' + playerIndex + '/mission', {
                succeed: self.missionSuccess() === succeed ? null : succeed
            });
        }
        
        self.save = function () {
            var playerIndex = gameModel.players.mappedIndexOf(self);
            $.ajax('/' + gameModel.id + '/_api/users/' + playerIndex, {
                data: { isReady: self.isReady() },
                type: 'PATCH'
            });
        }
        
        self.join = function () {
            $.post('/' + gameModel.id + '/_api/users');
        }
        
        self.leave = function () {
            var playerIndex = gameModel.players.mappedIndexOf(self);
            $.ajax('/' + gameModel.id + '/_api/users/' + playerIndex, {
                type: 'DELETE'
            });
        }
    }
    
    var gameModel = new Game(data);
    ko.applyBindings(gameModel, $('#game')[0]);
});