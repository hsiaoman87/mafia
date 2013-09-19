$(function () {
    $(document).ajaxError(function (e, jqXHR) {
        alert(jqXHR.responseText);
    });
    
    $(document).keydown(function (e) {
        if (e.which === 27) {
            gameModel.unimpersonate();
        }
        else if (e.shiftKey) {
            var playerIndex = e.which - 48;
            if (gameModel.players()[playerIndex]) {
                gameModel.players()[playerIndex].impersonate();
            }
        }
    });
    $('#player-name').focus();
    
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
        self.debug = document.cookie.indexOf('debug-mafia=1') !== -1;
        self.leaderIndex = ko.observable();
        self.currentRound = ko.observable();
        ko.mapping.fromJS(data.game, {
            copy: ['id'],
            players: {
                create: function (options) {
                    return new Player(options.data);
                }
            },
            rounds: {
                create: function (options) {
                    return new Round(options.data, self);
                }
            }
        }, this);
        
        self.socket = io.connect('http://' + data.socketIp);
        self.socket.on('refresh', function (game) {
            ko.mapping.fromJS(game, self);
        });
        
        self.currentPlayerIndex = ko.observable(data.currentPlayerIndex);
        
        self.currentPlayer = ko.computed(function () {
            if (isNaN(self.currentPlayerIndex())) {
                return new Player();
            }
            else {
                return self.players()[self.currentPlayerIndex()];
            }
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
            return $.grep(self.players(), function (element, index) {
                return element.nominee();
            });
        });
        
        self.currentLeader = ko.computed(function () {
            return self.players()[self.leaderIndex()];
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
                ko.mapping.fromJS(game, self);
            });
        };
        
        self.unimpersonate = function () {
            $.get('/impersonate/' + self.id, function() {
                location.reload();
            });
        }
    }
    
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
                if (iteration.vote) {
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
    
    function Player(data) {
        var self = this;
        
        self.isSelected = ko.observable(false);
        self.nominee = ko.observable(false);
        self.isReady = ko.observable(false);
        self.name = ko.observable();
        self.id = ko.observable();
        ko.mapping.fromJS(data, {
        }, this);
        
        self.isReady.subscribe(function () {
            self.save();
        });
        
        self.impersonate = function () {
            $.get('/impersonate/' + gameModel.id + '/' + self.id(), function (data) {
                gameModel.currentPlayerIndex(data.currentPlayerIndex);
                
                if (gameModel.phase() === 'init') {
                    $('#player-name').focus();
                }
            });
        }
        
        self.vote = function (approve) {
            var playerIndex = gameModel.players.mappedIndexOf(self);
            $.post('/' + gameModel.id + '/_api/' + playerIndex + '/vote', {
                approve: approve
            },
            function (game) {
                ko.mapping.fromJS(game, gameModel);
            });
        };
        
        self.mission = function (succeed) {
            var playerIndex = gameModel.players.mappedIndexOf(self);
            $.post('/' + gameModel.id + '/_api/' + playerIndex + '/mission', {
                succeed: succeed
            },
            function (game) {
                ko.mapping.fromJS(game, gameModel);
            });
        };
        
        self.save = function () {
            if (self.id()) {
                $.ajax('/' + gameModel.id + '/_api/users/' + self.id(), {
                    data: {
                        name: self.name,
                        isReady: self.isReady
                    },
                    type: 'PATCH',
                    success: function (player) {
                        // TODO: update players in case game is ready
                        ko.mapping.fromJS(player, self);
                    }
                });
            }
            else {
                $.post('/' + gameModel.id + '/_api/users', {
                    name: self.name,
                    isReady: self.isReady
                },
                function (player) {
                    // TODO: add new player to list
                    ko.mapping.fromJS(player, self);
                });
            }
        };
    }
    
    var gameModel = new Game(data);
    ko.applyBindings(gameModel, $('#game')[0]);
});