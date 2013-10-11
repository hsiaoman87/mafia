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
        
        if (self.debug) {
            $.ajaxSetup({
                data: { debug: true }
            });
        }
        
        self.inProgress = ko.observable(false);
        
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
        
        self.getAffiliation = function () {
            return $.get('/' + self.id + '/_api/game', null, function (game) {
                ko.mapping.fromJS(game, self);
            });
        }
        
        self.chatMessages = ko.observableArray();
        self.newMessage = ko.observable();
        self.sendMessage = function (message) {
            self.socket.emit('chatMessage', {
                message: message,
                room: self.id,
                user: ko.mapping.toJS(self.user)
            });
        }
        self.onKeyPress = function (model, e) {
            if (e.keyCode === $.ui.keyCode.ENTER) {
                if (self.newMessage() && $.trim(self.newMessage())) {
                    self.sendMessage($.trim(self.newMessage()));
                    self.newMessage(null);
                }
            }
            else {
                return true;
            }
        }
        
        self.focused = ko.observable(true);
        window.onfocus = function () {
            self.focused(true);
            if (self.notificationInterval) {
                clearInterval(self.notificationInterval);
                self.notificationInterval = null;
            }
            document.title = self.originalTitle;
        }
        window.onblur = function () {
            self.focused(false);
        }
        
        $(window).bind('beforeunload', function () {
            self.socket.disconnect();
            self.unloadTimeout = setTimeout(function () {
                self.connectSocket();
            }, 500);
            if (self.currentPlayer().playerIndex() !== -1) {
                if (self.phase() === PHASE.Init) {
                    self.currentPlayer().leave().complete(function () {
                        self.getAffiliation();
                    });
                    return 'You have left the game.';
                }
                else if (self.phase() !== PHASE.Final) {
                    return 'This game is still in progress!';
                }
            }
            return 'You have left the room.';
        });
        $(window).unload(function () {
            if (self.unloadTimeout) {
                clearTimeout(self.unloadTimeout);
            }
        });
        
        self.connectSocket = function () {
            self.socket = io.connect(null, { 'force new connection': true });
            self.socket.on('connect', function () {
                self.socket.emit('join', {
                    room: self.id,
                    user: ko.mapping.toJS(self.user)
                });
            });
            self.socket.on('refresh', function (game) {
                console.log('refreshed');
                ko.mapping.fromJS(game, self);
            });
            self.socket.on('start', function () {
                self.getAffiliation().success(function () {
                    self.currentPlayer().displayAffiliation();
                });
            });
            self.socket.on('sendMessage', function (data) {
                if (data.user && !self.focused()) {
                    if (self.notificationInterval) {
                        clearInterval(self.notificationInterval);
                    }
                    document.title = data.user.name + ' says...';
                    self.notificationInterval = setInterval(function () {
                        if (document.title === self.originalTitle) {
                            document.title = data.user.name + ' says...';
                        }
                        else {
                            document.title = self.originalTitle;
                        }
                    }, 2000);
                }
                self.chatMessages.push(new ChatMessage(data));
                if (self.autoScroll()) {
                    $('.chat-window').scrollTop($('.chat-window')[0].scrollHeight);
                }
            });
            self.socket.on('displayNominees', function (data) {
                var message = 'The following team has been selected: \n';
                $.each(data.ids, function (index, id) {
                    message += '\n' + self.players()[id].name();
                });
                alert(message);
            });
            self.socket.on('displayVoteResults', function (data) {
                
                var approvals = data.yesVotes;
                var rejections = data.noVotes;
                
                var message = approvals.length > rejections.length ? 'Vote approved!' : 'Vote rejected!';
                
                if (approvals.length) {
                    message += '\n\nApproved by:';
                    $.each(approvals, function (index, id) {
                        message += '\n' + self.players()[id].name();
                    });
                }
                if (rejections.length) {
                    message += '\n\nRejected by:';
                    $.each(rejections, function (index, id) {
                        message += '\n' + self.players()[id].name();
                    });
                }
                
                alert(message);
            });
            self.socket.on('error', function (data) {
                console.log('error');
                console.log(data);
            });
            self.socket.on('disconnect', function (data) {
                console.log('disconnect');
                console.log(data);
            });
        }
        
        self.connectSocket();
        
        self.originalTitle = document.title;
        self.autoScroll = ko.observable(true);
        
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
        
        self.currentLeader = ko.computed(function () {
            return self.players()[self.leaderIndex()];
        });
        
        self.isLeader = ko.computed(function () {
            return self.currentLeader() === self.currentPlayer();
        });
        
        self.nominees = ko.computed(function () {
            var nominees = [];
            $.each(self.players(), function (index, player) {
                if (player.isSelected()) {
                    nominees.push(index);
                }
            });
            return nominees;
        });
        
        self.readyToNominate = ko.computed(function () {
            return self.teamSize() === self.nominees().length;
        });
        
        self.nominate = function () {
            var nomineeIds = self.nominees();
            
            self.inProgress(true);
            $.post('/' + self.id + '/_api/nominate', {
                ids: nomineeIds
            },
            function (game) {
                self.inProgress(false);
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
            if (self.debug) {
                self.inProgress(true);
                $.ajax({
                    url: '/impersonate/' + self.id,
                    success: function() {
                        $(window).unbind('beforeunload');
                        location.reload();
                    }
                });
            }
        }
        
        self.mafiaPlayers = ko.computed(function () {
            return $.grep(self.players(), function (player) {
                return player.affiliation() === AFFILIATION.Mafia;
            });
        });
        
        self.finalGameResult = ko.computed(function () {
            if (self.phase() === PHASE.Final && self.currentPlayer().playerIndex() !== -1) {
                var winningMissionCount = 0;
                for (var i = 0; i < self.rounds().length; i++) {
                    var round = self.rounds()[i];
                    if (round.failedVoteCount() === 5) {
                        return 'The townspeople were unable to come to consensus.  Mafia wins.';
                    }
                    if ((self.currentPlayer().affiliation() === AFFILIATION.Mafia) ^ round.result()) {
                        winningMissionCount++;
                    }
                }
                if (winningMissionCount === 3) {
                    return 'You win!';
                }
                else {
                    return 'You lose!';
                }
            }
            else {
                return null;
            }
        });
        
        self.failedNominations = ko.computed(function () {
            var currentRound = self.rounds()[self.currentRound()];
            if (currentRound) {
                return new Array(currentRound.failedVoteCount());
            }
            else {
                return new Array();
            }
        });
    }
    
    //$('.toggle-button').button();
    //$('button').button();
    
    function ChatMessage(data) {
        var self = this;
        self.user = ko.observable();
        self.message = ko.observable();
        ko.mapping.fromJS(data, {}, this);
        
        self.displayMessage = ko.computed(function () {
            if (self.user()) {
                return self.user().name() + ': ' + self.message();
            }
            else {
                return self.message();
            }
        });
    }
    
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
            if (gameModel.debug) {
                gameModel.inProgress(true);
                $.ajax({
                    url: '/impersonate/' + gameModel.id + '/' + self.playerIndex(),
                    success: function (data) {
                        gameModel.inProgress(false);
                        ko.mapping.fromJS(data, gameModel.user());
                        console.log('impersonate');
                        console.log(data);
                        gameModel.getAffiliation();
                    }
                });
            }
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
            gameModel.inProgress(true);
            $.post('/' + gameModel.id + '/_api/' + self.playerIndex() + '/vote', {
                approve: self.voteApprove() === approve ? null : approve
                }).complete(function () {
                gameModel.inProgress(false);
            });
        }
        
        self.mission = function (succeed) {
            gameModel.inProgress(true);
            $.post('/' + gameModel.id + '/_api/' + self.playerIndex() + '/mission', {
                succeed: self.missionSuccess() === succeed ? null : succeed
                }).complete(function () {
                gameModel.inProgress(false);
            });
        }
        
        self.save = function () {
            gameModel.inProgress(true);
            $.ajax('/' + gameModel.id + '/_api/users/' + self.playerIndex(), {
                data: { isReady: self.isReady() },
                type: 'PATCH'
            }).complete(function () {
                gameModel.inProgress(false);
            });
        }
        
        self.join = function () {
            gameModel.inProgress(true);
            $.post('/' + gameModel.id + '/_api/users').complete(function () {
                gameModel.inProgress(false);
            });
        }
        
        self.leave = function () {
            gameModel.inProgress(true);
            return $.ajax('/' + gameModel.id + '/_api/users/' + self.playerIndex(), {
                type: 'DELETE'
            }).complete(function () {
                gameModel.inProgress(false);
            });
        }
    }
    
    var gameModel = new Game(data);
    ko.applyBindings(gameModel, $('#game')[0]);
});