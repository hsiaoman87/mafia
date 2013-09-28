$(function () {
    $('#user-name').click(function () {
        var userName = $.trim(prompt('Change your name:', $(this).text()));
        if (userName) {
            $.post('/edit', {
                name: userName
            }, function () {
                location.reload();
            });
        }
    });
});