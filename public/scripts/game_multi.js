$(function () {
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
                }
            }
        }, this);
        
        self.socket = io.connect('/');
        self.socket.on('connection', function () {
            self.socket.emit('join', { room: self.id });
        });
        self.socket.on('refresh', function (game) {
            console.log('refreshed');
            console.log(game);
            ko.mapping.fromJS(game, self);
        });
        
        self.user = ko.observable(new Player(data.user, self));
        
        self.currentPlayer = ko.computed(function () {
            return $.grep(self.players(), function (player) {
                return player.user.id() === self.user()._id();
            })[0] || self.user();
        });
        
        self.hasTeamMates = ko.computed(function () {
            if (self.currentPlayer()) {
                return self.currentPlayer().affiliation() === AFFILIATION.Mafia;
            }
            else {
                return false;
            }
        });
        
        self.teamMates = ko.computed(function () {
            return $.grep(self.players(), function (player) {
                return player.affiliation() === AFFILIATION.Mafia;
            });
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
                return isNaN(result) ? null : result ? 'success' : 'fail';
            });
        });
        
        self.currentLeader = ko.computed(function () {
            return self.players()[self.leaderIndex()];
        });
        
        self.isLeader = ko.computed(function () {
            return self.phase() === 'nominate' && self.currentLeader() === self.currentPlayer();
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
        };
        
        self.unimpersonate = function () {
            $.ajax({
                url: '/impersonate/' + self.id,
                success: function() {
                    location.reload();
                },
                global: false
            });
        }
    }
    
    //$('.toggle-button').button();
    
    function Round(data, game) {
        var self = this;
        self.result = ko.observable();
        self.failCount = ko.observable();
        ko.mapping.fromJS(data, {
            history: {
                create: function (options) {
                    return new HistoryEntry(options.data, game);
                }
            }
        }, this);
    }
    
    function HistoryEntry(data, game) {
        var self = this;
        ko.mapping.fromJS(data, {
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
                },
                global: false
            });
        }
        
        self.vote = function (approve) {
            var playerIndex = gameModel.players.mappedIndexOf(self);
            $.post('/' + gameModel.id + '/_api/' + playerIndex + '/vote', {
                approve: self.voteApprove() === approve ? null : approve
            });
        };
        
        self.mission = function (succeed) {
            var playerIndex = gameModel.players.mappedIndexOf(self);
            $.post('/' + gameModel.id + '/_api/' + playerIndex + '/mission', {
                succeed: self.missionSuccess() === succeed ? null : succeed
            });
        };
        
        self.save = function () {
            var playerIndex = gameModel.players.mappedIndexOf(self);
            $.ajax('/' + gameModel.id + '/_api/users/' + playerIndex, {
                data: { isReady: self.isReady() },
                type: 'PATCH'
            });
        };
        
        self.join = function () {
            $.post('/' + gameModel.id + '/_api/users');
        };
        
        self.leave = function () {
            var playerIndex = gameModel.players.mappedIndexOf(self);
            $.ajax('/' + gameModel.id + '/_api/users/' + playerIndex, {
                type: 'DELETE'
            });
        };
    }
    
    var gameModel = new Game(data);
    ko.applyBindings(gameModel, $('#game')[0]);
});