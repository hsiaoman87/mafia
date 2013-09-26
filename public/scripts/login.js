$(function () {
    function LoginModel() {
        var self = this;
        
        self.createGuest = function () {
            var guestName = $.trim(prompt('Enter your name'));
            console.log(guestName.trim());
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