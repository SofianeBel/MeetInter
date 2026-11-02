const list = document.querySelector('#sources');

document.querySelector('#none').onclick = () => api.pickerChoose(null);
addEventListener('keydown', (e) => { if (e.key === 'Escape') api.pickerChoose(null); });

api.pickerSources().then((sources) => {
  if (!sources.length) { list.innerHTML = '<p class="muted">Aucune fenêtre à enregistrer.</p>'; return; }
  list.replaceChildren(...sources.map((s) => {
    const b = document.createElement('button');
    b.className = 'src';
    b.title = s.name;
    b.append(Object.assign(document.createElement('img'), { src: s.thumbnail, alt: '' }), Object.assign(document.createElement('span'), { textContent: s.name }));
    b.onclick = () => api.pickerChoose({ id: s.id, name: s.name });
    return b;
  }));
});
