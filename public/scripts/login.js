$(function () {
    function LoginModel() {
        var self = this;

        self.login = function (model, e) {
            var data = $(e.target).closest('.login').data();
            if (data.url) {
                location.href = data.url;
            }
        }
        
        self.createGuest = function () {
            var guestName = $.trim(prompt('Warning: Guest logins are one-time use.  If you log out, you will not be able to log in as the same guest.\n\nEnter your name:', 'Guest'));
            if (guestName) {
                $.post('/auth/guest', {
                    name: guestName
                }, function () {
                    location.href = referer || '/';
                });
            }
        }
    }
    ko.applyBindings(new LoginModel());
});