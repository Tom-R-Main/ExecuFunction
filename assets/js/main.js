(function(){
  const form = document.querySelector('#waitlist-form');
  const msg = document.querySelector('#waitlist-msg');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = '';
      const email = (document.querySelector('#waitlist-email') || {}).value || '';
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msg.textContent = 'Please enter a valid email.';
        msg.style.color = '#fca5a5';
        return;
      }
      try {
        const res = await fetch('/api/join-waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          body: JSON.stringify({ email })
        });
        if (res.status === 201) {
          msg.textContent = 'Thanks! You\'re on the list.';
          msg.style.color = '#6ee7b7';
          form.reset();
        } else if (res.status === 429) {
          msg.textContent = 'Too many attempts. Please try again later.';
          msg.style.color = '#fca5a5';
        } else {
          const data = await res.json().catch(() => ({}));
          msg.textContent = data.error || 'Something went wrong.';
          msg.style.color = '#fca5a5';
        }
      } catch (err) {
        msg.textContent = 'Network error. Please try again.';
        msg.style.color = '#fca5a5';
      }
    });
  }
})();

