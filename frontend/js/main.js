// main.js

document.addEventListener('DOMContentLoaded', function () {
    // Basic button interactions for demo
    const loginBtn = document.getElementById('loginBtn');
    const signupBtn = document.getElementById('signupBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            alert('Login functionality would go here.');
            // Redirect or show login modal
        });
    }

    if (signupBtn) {
        signupBtn.addEventListener('click', () => {
            alert('Signup functionality would go here.');
            // Redirect or show signup modal
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            alert('Logout functionality would go here.');
            // Perform logout actions, redirect to index
        });
    }

    // Tab switching logic (if needed globally or for other pages)
    const tabBtns = document.querySelectorAll('.tab-btn');
    if (tabBtns.length > 0) {
        tabBtns.forEach(button => {
            button.addEventListener('click', () => {
                // Remove active class from all buttons and content
                document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

                // Add active class to clicked button
                button.classList.add('active');

                // Show corresponding content
                const tabName = button.getAttribute('data-tab');
                const tabContent = document.getElementById(tabName + 'Tab');
                if (tabContent) {
                    tabContent.classList.add('active');
                }
            });
        });
    }
});