$(function () {
    function LoginModel() {
        var self = this;
        
        self.createGuest = function () {
            if (confirm('Warning: Guest logins are one-time use.  If you log out, you will not be able to log in as the same guest.  Do you still want to log in as a guest?')) {
                var guestName = $.trim(prompt('Enter your name:', 'Guest'));
                if (guestName) {
                    $.post('/auth/guest', {
                        name: guestName
                    }, function () {
                        location.href = referer || '/';
                    });
                }
            }
        }
    }
    ko.applyBindings(new LoginModel());
});