(function(){
  // Parse and store UTM parameters
  const params = new URLSearchParams(window.location.search);
  const utmData = {
    utm_source: params.get('utm_source') || '',
    utm_medium: params.get('utm_medium') || '',
    utm_campaign: params.get('utm_campaign') || ''
  };
  
  // Waitlist form handler
  const form = document.querySelector('#waitlist-form');
  const msg = document.querySelector('#waitlist-msg');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = '';
      const email = (document.querySelector('#waitlist-email') || {}).value || '';
      const btn = form.querySelector('button[type="submit"]');
      
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msg.textContent = 'Please enter a valid email.';
        msg.style.color = '#fca5a5';
        return;
      }
      
      btn.disabled = true;
      btn.textContent = 'Joining...';
      
      try {
        const res = await fetch('/api/join-waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          body: JSON.stringify({ 
            email,
            ...utmData,
            tags: ['general'] 
          })
        });
        
        const data = await res.json().catch(() => ({}));
        
        if (res.status === 201 || res.status === 200) {
          if (data.already) {
            msg.textContent = 'You\'re already on the list!';
            msg.style.color = '#60a5fa';
          } else {
            msg.textContent = 'Thanks! You\'re on the list.';
            msg.style.color = '#1dd3b0';
          }
          form.reset();
        } else if (res.status === 429) {
          msg.textContent = 'Too many attempts. Please wait a minute and try again.';
          msg.style.color = '#fca5a5';
        } else {
          msg.textContent = data.error || 'Something went wrong. Please try again.';
          msg.style.color = '#fca5a5';
        }
      } catch (err) {
        msg.textContent = 'Network error. Please try again.';
        msg.style.color = '#fca5a5';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Join';
      }
    });
  }
  
  // Contact modal functionality
  const contactModal = document.getElementById('contact-modal');
  const contactBtn = document.getElementById('contact-btn');
  const closeModal = document.getElementById('close-modal');
  const contactForm = document.getElementById('contact-form');
  const contactMsg = document.getElementById('contact-msg');
  
  if (contactBtn && contactModal) {
    contactBtn.addEventListener('click', (e) => {
      e.preventDefault();
      contactModal.classList.add('show');
      document.body.style.overflow = 'hidden';
    });
  }
  
  if (closeModal && contactModal) {
    closeModal.addEventListener('click', () => {
      contactModal.classList.remove('show');
      document.body.style.overflow = '';
    });
  }
  
  if (contactModal) {
    contactModal.addEventListener('click', (e) => {
      if (e.target === contactModal) {
        contactModal.classList.remove('show');
        document.body.style.overflow = '';
      }
    });
  }
  
  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (contactMsg) contactMsg.textContent = '';
      
      const email = document.getElementById('contact-email').value.trim();
      const message = document.getElementById('contact-message').value.trim();
      const btn = contactForm.querySelector('button[type="submit"]');
      
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (contactMsg) {
          contactMsg.textContent = 'Please enter a valid email.';
          contactMsg.style.color = '#fca5a5';
        }
        return;
      }
      
      if (!message || message.length < 5) {
        if (contactMsg) {
          contactMsg.textContent = 'Please enter a message (at least 5 characters).';
          contactMsg.style.color = '#fca5a5';
        }
        return;
      }
      
      btn.disabled = true;
      btn.textContent = 'Sending...';
      
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, message })
        });
        
        if (res.status === 201) {
          if (contactMsg) {
            contactMsg.textContent = 'Thanks! We\'ll get back to you soon.';
            contactMsg.style.color = '#1dd3b0';
          }
          contactForm.reset();
          setTimeout(() => {
            contactModal.classList.remove('show');
            document.body.style.overflow = '';
            if (contactMsg) contactMsg.textContent = '';
          }, 2000);
        } else {
          if (contactMsg) {
            contactMsg.textContent = 'Couldn\'t send right now. Please try again.';
            contactMsg.style.color = '#fca5a5';
          }
        }
      } catch (err) {
        if (contactMsg) {
          contactMsg.textContent = 'Network error. Please try again.';
          contactMsg.style.color = '#fca5a5';
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Send';
      }
    });
  }
})();

