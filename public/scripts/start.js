$(function () {
    function StartModel() {
        var self = this;
        self.players = ko.observableArray();
        
        self.joinGameId = '';
        self.rejoinGameId = '';
        self.rejoinUserId = '';
        
        self.startSingle = function () {
            $.post('/', {
                isMultiDevice: true
            },
            function (game) {
                location.href = '/' + game.id;
            });
        }
        
        self.startMulti = function () {
            $.post('/', {
                players: self.players()
            },
            function (game) {
                location.href = '/' + game.id;
            });
        }
        
        self.join = function () {
            $.post(self.joinGameId + '/_api/join', null,
            function (game) {
                location.href = '/' + game.id;
            });
        }
        
        self.rejoin = function() {
            $.post(self.rejoinGameId + '/_api/join', {
                userId: self.rejoinUserId
            },
            function (game) {
                location.href = '/' + game.id;
            });
        }
        
        self.addPlayer = function () {
            self.players.push({
                name: '',
                hasFocus: true
            });
        }
        
        self.onKeyPress = function (model, e) {
            if (e.keyCode === $.ui.keyCode.ENTER) {
                self.addPlayer();
            }
            return true;
        }
    }
    ko.applyBindings(new StartModel());
});