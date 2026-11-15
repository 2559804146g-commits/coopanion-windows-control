"""Isolated CPU worker. All paths are supplied by the local studio, never by chat."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys


def sha(file):
    h = hashlib.sha256()
    with open(file, 'rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024**2), b''):
            h.update(block)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('job')
    ap.add_argument('phase', choices=['separate', 'convert'])
    args = ap.parse_args()
    job = json.loads(Path(args.job).read_text(encoding='utf-8'))
    cfg = job['engine']
    out = Path(args.job).resolve().parent
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
                      CUDA_VISIBLE_DEVICES='-1', OMP_NUM_THREADS='4',
                      APPLIO_CONFIG_FILE=str(out / 'applio-settings.json'),
                      APPLIO_LOGS_DIR=str(out / 'runtime-logs'))
    import torch
    torch.set_num_threads(4)
    if torch.cuda.is_available():
        raise RuntimeError('This worker requires the configured CPU runtime')
    # Verify trusted model bytes before loading any serialization.
    for entry in cfg['files']:
        if sha(entry['path']) != entry['sha256']:
            raise ValueError('Engine/model bytes changed: ' + Path(entry['path']).name)
    if args.phase == 'separate':
        from audio_separator.separator import Separator
        model = Path(cfg['separator'])
        if not model.is_file():
            raise ValueError('Separator model is not installed')
        separator = Separator(log_level=30, model_file_dir=str(model.parent),
                              output_dir=str(out), output_format='WAV', sample_rate=44100,
                              mdxc_params={'segment_size': 256, 'override_model_segment_size': False,
                                           'batch_size': 1, 'overlap': 2, 'pitch_shift': 0})
        def installed_only(url, filename):
            if not Path(filename).is_file():
                raise ValueError('Missing installed model metadata: ' + Path(filename).name)
        separator.download_file_if_not_exists = installed_only
        separator.load_model(model_filename=model.name)
        files = separator.separate(str(out / 'input.wav'))
        vocals = next((f for f in files if '(Vocals)' in f), None)
        instrumental = next((f for f in files if '(Instrumental)' in f or '(Other)' in f), None)
        if not vocals or not instrumental:
            raise ValueError('Separator did not produce both actual stems')
        stems = {'vocals': str((out / vocals).resolve()),
                 'instrumental': str((out / instrumental).resolve())}
        if any(not Path(f).is_relative_to(out) or not Path(f).is_file() for f in stems.values()):
            raise ValueError('Invalid separator output')
        (out / 'stems.json').write_text(json.dumps(stems), encoding='utf-8')
    else:
        repo = Path(cfg['applio']).resolve()
        os.chdir(repo)
        sys.path.insert(0, str(repo))
        from rvc.configs.config import inference_config
        from rvc.infer.infer import VoiceConverter
        settings = inference_config()
        settings.device = 'cpu'
        converter = VoiceConverter(config=settings)
        voice = next(v for v in cfg['voices'] if v['id'] == job['voiceId'])
        converter.convert_audio(str(out / 'vocal.wav'), str(out / 'converted.wav'),
                                voice['model'], voice.get('index', ''), pitch=job['pitch'],
                                f0_method='rmvpe', index_rate=0.3, protect=0.33,
                                volume_envelope=1.0, export_format='WAV',
                                embedder_model='contentvec', inference_engine='torch')
        if Path(converter.model_path).resolve() != Path(voice['model']).resolve() or not (out / 'converted.wav').is_file():
            raise ValueError('Selected voice did not produce converted audio')
        import numpy as np
        import soundfile as sf
        wave, rate = sf.read(out / 'converted.wav')
        if not len(wave) or not np.isfinite(wave).all() or np.sqrt(np.mean(wave**2)) < 1e-7:
            raise ValueError('Converted vocal is invalid or silent')
        (out / 'conversion.json').write_text(json.dumps({
            'engine': 'Applio-RVC-CPU', 'voiceId': voice['id'],
            'modelSha256': sha(voice['model']), 'seconds': len(wave) / rate,
            'sampleRate': rate, 'pitch': job['pitch'], 'indexRate': 0.3,
            'protect': 0.33, 'weightsOnly': True,
        }), encoding='utf-8')


if __name__ == '__main__':
    main()
