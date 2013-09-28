$(function () {
    $('#user-name').click(function () {
        var userName = $.trim(prompt('Enter your name', $(this).text()));
        if (userName) {
            $.post('/edit', {
                name: userName
            }, function () {
                location.reload();
            });
        }
    });
});