$(function () {
    function LoginModel() {
        var self = this;
        
        self.createGuest = function () {
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
    ko.applyBindings(new LoginModel());
});