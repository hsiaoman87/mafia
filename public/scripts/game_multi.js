$(function () {
    $(document).ajaxError(function (e, jqXHR) {
        alert(jqXHR.responseText);
    });
    
    $(document).keydown(function (e) {
        if (e.which === 27) {
            debugger;
            gameModel.unimpersonate();
        }
    });
    $('#player-name').focus();
    
    function Game(existing, currentPlayerIndex) {
        var self = this;
        self.currentRound = '';
        self.leaderIndex = '';
        self.phase = '';
        $.extend(this, existing);
        
        self.currentPlayerIndex = currentPlayerIndex;
        
        self.players = $.map(self.players, function (element, index) {
            return new Player(element, index);
        });
        
        self.nominees = $.map(self.players, function (element, index) {
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
        
        self.unimpersonate = function () {
            $.get('/impersonate/' + self.id, function() {
                location.reload();
            });
        }
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