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
            if (gameModel.players[playerIndex]) {
                gameModel.players[playerIndex].impersonate();
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
    
    function Game(existing, currentPlayerIndex) {
        var self = this;
        self.currentRound = '';
        self.leaderIndex = '';
        self.phase = '';
        $.extend(this, existing);
        
        self.currentPlayerIndex = currentPlayerIndex;
        
        self.teamSize = ko.computed(function () {
            return gameData[self.players.length].teamCount[self.currentRound];
        });
        
        self.players = $.map(self.players, function (element, index) {
            return new Player(element, index);
        });
        
        self.nominees = $.map(self.players, function (element) {
            return $.extend({
                isSelected: false
            }, element);
        });
        
        self.candidates = ko.computed(function () {
            return $.grep(self.players, function (element, index) {
                return element.nominee;
            });
        });
        
        self.currentLeader = ko.computed(function () {
            return self.players[self.leaderIndex];
        });
        
        self.submitNominees = function () {
            var nomineeIds = [];
            $.each(self.nominees, function (index, element) {
                if (element.isSelected) {
                    nomineeIds.push(index);
                }
            });
            
            $.post('/' + self.id + '/_api/nominate', {
                ids: nomineeIds
            },
            function (game) {
                location.href = '/' + game.id;
            });
        };
        
        self.rounds = $.map(self.rounds, function (round) {
            return new Round(round, self);
        });
        
        self.unimpersonate = function () {
            $.get('/impersonate/' + self.id, function() {
                location.reload();
            });
        }
    }
    
    function Round(existing, game) {
        var self = this;
        self.result = '';
        self.failCount = '';
        $.extend(this, existing);
        
        self.history = $.map(self.history, function (history) {
            return new HistoryEntry(history, game);
        });
    }
    
    function HistoryEntry(existing, game) {
        var self = this;
        $.extend(this, existing);
        
        self.playerIterations = ko.computed(function () {
            return $.map(self.iterations, function (iteration, index) {
                return $.extend({
                    voteDecision: iteration.vote,
                    isTeamMember: iteration.teamMember
                }, game.players[index]);
            });
        });
        
        self.voteCounts = ko.computed(function () {
            var approveCount = 0;
            var rejectCount = 0;
            $.each(self.iterations, function (index, iteration) {
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
            return game.players[self.leaderIndex];
        });
        
        self.teamMembers = ko.computed(function () {
            return $.grep(self.playerIterations(), function (player, index) {
                return player.isTeamMember;
            });
        });
    }
    
    function Player(existing, playerIndex) {
        var self = this;
        
        self.playerIndex = playerIndex;
        
        self.name = '';
        self.id = '';
        self.isReady = false;
        self.nominee = false;
        
        self.impersonate = function () {
            $.get('/impersonate/' + game.id + '/' + self.id, function() {
                location.reload();
            });
        }
        
        self.vote = function (approve) {
            $.post('/' + game.id + '/_api/' + self.playerIndex + '/vote', {
                approve: approve
            },
            function (game) {
                location.href = '/' + game.id;
            });
        };
        
        self.mission = function (succeed) {
            $.post('/' + game.id + '/_api/' + self.playerIndex + '/mission', {
                succeed: succeed
            },
            function (game) {
                location.href = '/' + game.id;
            });
        };
        
        if (existing) {
            $.extend(this, existing);
            
            self.save = function () {
                $.ajax('/' + game.id + '/_api/users/' + self.id, {
                    data: {
                        name: self.name,
                        isReady: self.isReady
                    },
                    type: 'PATCH',
                    success: function (game) {
                        location.reload();
                    }
                });
            };
        }
        else {
            self.save = function () {
                $.post('/' + game.id + '/_api/users', {
                    name: self.name,
                    isReady: self.isReady
                },
                function (game) {
                    location.reload();
                });
            };
        }
    }
    var gameModel = new Game(data.game, data.currentPlayerIndex);
    ko.applyBindings(gameModel, $('#game')[0]);
    
    var playerModel;
    if (isNaN(data.currentPlayerIndex)) {
        playerModel = new Player();
    }
    else {
        playerModel = gameModel.players[data.currentPlayerIndex];
    }
    ko.applyBindings(playerModel, $('#currentPlayer')[0]);
});