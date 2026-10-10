import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from motion_input import validate,to_h36m

class MotionInputTests(unittest.TestCase):
    def data(self):return {'width':720,'height':1280,'frames':[{'t':0,'screen':[[.5,.5,1] for _ in range(33)]}]}
    def test_h36m_right_left_order_and_aspect(self):
        s=self.data()['frames'][0]['screen'];s[24]=[.75,.5,.8];s[23]=[.25,.5,.6];s[16]=[.5,.75,.4]
        p=to_h36m(s,720,1280)
        self.assertEqual(p[1],[.5,0,.8]);self.assertEqual(p[4],[-.5,0,.6]);self.assertAlmostEqual(p[16][1],640/720);self.assertEqual(p[0],[0,0,.6])
    def test_synthetic_torso_confidence_uses_weaker_anchor(self):
        s=self.data()['frames'][0]['screen'];s[11][2]=.2;s[24][2]=.4
        p=to_h36m(s,720,1280)
        self.assertEqual(p[8][2],.2);self.assertEqual(p[7][2],.2)
    def test_missing_frames_remain_valid_input(self):
        d=self.data();d['frames'].append({'t':1/30,'screen':None});self.assertIs(validate(d),d)
    def test_invalid_lengths_timestamps_and_nan_rejected(self):
        d=self.data();d['frames']*=2702
        with self.assertRaises(ValueError):validate(d)
        d=self.data();d['frames'].append(d['frames'][0])
        with self.assertRaises(ValueError):validate(d)
        d=self.data();d['frames'][0]['screen'][0][0]=float('nan')
        with self.assertRaises(ValueError):validate(d)
    def test_invalid_dimensions_and_confidence_rejected(self):
        d=self.data();d['height']=False
        with self.assertRaises(ValueError):validate(d)
        d=self.data();d['frames'][0]['screen'][0][2]=2
        with self.assertRaises(ValueError):validate(d)
if __name__=='__main__':unittest.main()
