// PeakU AI — comportamiento de la barra de la plataforma (compartido por los tres módulos).
// Marca el módulo activo por la ruta y deja el título de la pestaña como "PeakU AI · módulo".
(function () {
  var ruta = location.pathname;
  var mod = ruta.indexOf('/sdr') === 0 ? 'sdr' : ruta.indexOf('/verificacion') === 0 ? 'verify' : 'ventas';
  var nombres = { ventas: 'Ventas', sdr: 'Prospección', verify: 'Verificación' };
  document.querySelectorAll('.pk-mods [data-mod]').forEach(function (a) { a.classList.toggle('pk-on', a.getAttribute('data-mod') === mod); });
  document.body.classList.add('pk-' + mod);
  if (!/PeakU AI/.test(document.title)) document.title = 'PeakU AI · ' + nombres[mod];
  // Un módulo con una sola persona: el nombre bajo el switcher no hace falta; queda en el <title>.
})();
