import 'prefs_io.dart' if (dart.library.html) 'prefs_web.dart';

/// Preferências do aparelho (tema e paleta). No web vão para o
/// `localStorage`; fora dele (testes na VM) ficam só em memória.
abstract class Prefs {
  factory Prefs() = PrefsImpl;

  String? read(String key);
  void write(String key, String value);
}
