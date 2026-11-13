/// Opções lidas da URL ao abrir o painel. Servem para demonstração e para
/// os testes automáticos de layout:
///   ?demo=1            entra direto no modo demonstração
///   ?tab=agenda        abre numa seção (nome ou número)
///   ?tema=claro|escuro força o modo
class LaunchOptions {
  static Map<String, String> get _q {
    try {
      final base = Uri.base;
      // Funciona com e sem rota em hash (#/automacao?x=1)
      final fromHash = base.fragment.contains('?') ? Uri.splitQueryString(base.fragment.split('?').last) : <String, String>{};
      return {...base.queryParameters, ...fromHash};
    } catch (_) {
      return const {};
    }
  }

  static bool get demo => _q['demo'] == '1' || _q['demo'] == 'true';
  static String? get tab => _q['tab'];
  static String? get theme => _q['tema'];
  static String? get google => _q['google'];
}
