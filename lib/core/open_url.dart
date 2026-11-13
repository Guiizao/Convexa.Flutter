import 'open_url_io.dart' if (dart.library.html) 'open_url_web.dart' as impl;

/// Abre um link externo numa aba nova (web). Fora do web não faz nada:
/// quem chama deve ter copiado o link para a área de transferência.
void openExternal(String url) => impl.openExternal(url);
